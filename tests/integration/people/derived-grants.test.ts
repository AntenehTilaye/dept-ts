import { beforeAll, describe, expect, it, vi } from "vitest";
import { addMember, removeMember, setGroupStatus } from "@/platform/people/groups";
import { assignRepresentative } from "@/platform/people/representatives";
import { provisionUser } from "@/platform/identity/provision";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });

async function grantsOf(userId: string, scopeType: string, scopeId: string) {
  return withDept(DEPT_CS, (tx) =>
    tx.roleGrant.findMany({
      where: { userId, scopeType: scopeType as never, scopeId },
      include: { role: true },
      orderBy: { role: { key: "asc" } },
    }),
  );
}

describe("derived grants from registry facts", () => {
  let chairUserId: string;
  let chairPersonId: string;
  let memberPersonId: string;

  beforeAll(async () => {
    const chair = await migratorDb.user.findUniqueOrThrow({
      where: { email: "chair.cs@deptts.local" },
    });
    chairUserId = chair.id;
    await withDept(DEPT_CS, async (tx) => {
      chairPersonId = (
        await f.staff(tx, DEPT_CS, { userId: chair.id, email: "chair.cs@deptts.local" })
      ).id;
      memberPersonId = (await f.staff(tx, DEPT_CS)).id;
    });
  });

  it("gives a committee chair committee_member and committee_chair scoped to the committee, and members only the member grant", async () => {
    const { group } = await withDept(DEPT_CS, (tx) =>
      f.committee(tx, DEPT_CS, [
        { personId: chairPersonId, role: "chair" },
        { personId: memberPersonId },
      ]),
    );
    const grants = await grantsOf(chairUserId, "committee", group.id);
    expect(grants.map((g) => [g.role.key, g.source, g.derivedFromType, g.validTo])).toEqual([
      ["committee_chair", "derived", "group_membership", null],
      ["committee_member", "derived", "group_membership", null],
    ]);
    // the member has no login: nothing to grant, nothing thrown
    expect(
      await withDept(DEPT_CS, (tx) =>
        tx.roleGrant.count({ where: { scopeType: "committee", scopeId: group.id } }),
      ),
    ).toBe(2);

    // demoting the chair to member ends only the chair grant
    await withDept(DEPT_CS, (tx) =>
      addMember(tx, DEPT_CS, group.id, { personId: chairPersonId, roleInGroup: "member" }),
    );
    const after = await grantsOf(chairUserId, "committee", group.id);
    expect(after.find((g) => g.role.key === "committee_chair")?.validTo).toBeInstanceOf(Date);
    expect(
      after.filter((g) => g.role.key === "committee_member" && g.validTo === null),
    ).toHaveLength(1);

    // removal ends the member grant too
    await withDept(DEPT_CS, (tx) => removeMember(tx, DEPT_CS, group.id, chairPersonId));
    expect(
      (await grantsOf(chairUserId, "committee", group.id)).every((g) => g.validTo !== null),
    ).toBe(true);
  });

  it("deactivating a group closes its grants and reactivation restores them", async () => {
    const { group } = await withDept(DEPT_CS, (tx) =>
      f.committee(tx, DEPT_CS, [{ personId: chairPersonId, role: "chair" }]),
    );
    await withDept(DEPT_CS, (tx) => setGroupStatus(tx, DEPT_CS, group.id, "inactive"));
    let grants = await grantsOf(chairUserId, "committee", group.id);
    expect(grants).toHaveLength(2);
    expect(grants.every((g) => g.validTo instanceof Date)).toBe(true);
    await withDept(DEPT_CS, (tx) => setGroupStatus(tx, DEPT_CS, group.id, "active"));
    grants = await grantsOf(chairUserId, "committee", group.id);
    expect(grants).toHaveLength(2);
    expect(grants.every((g) => g.validTo === null)).toBe(true);
  });

  it("assigning a section representative invites the student and derives student_rep@section; a second primary is rejected", async () => {
    const email = `rep.${f.uniqueSuffix()}@deptts.local`;
    const { section, studentId, other } = await withDept(DEPT_CS, async (tx) => {
      const section = await f.section(tx, DEPT_CS);
      const s = await f.student(tx, DEPT_CS, {
        sectionId: section.id,
        email,
        fullName: "Future Rep",
      });
      const other = await f.student(tx, DEPT_CS, { sectionId: section.id });
      return { section, studentId: s.id, other: other.id };
    });
    const provision = vi.fn(async (p: { email: string; fullName: string }) => {
      const r = await provisionUser({
        email: p.email,
        name: p.fullName,
        departmentId: DEPT_CS,
        roleKeys: ["student_rep"],
        sendMail: false,
      });
      return r.userId;
    });
    const result = await withDept(DEPT_CS, (tx) =>
      assignRepresentative(tx, DEPT_CS, {
        sectionId: section.id,
        studentId,
        academicYearId: section.academicYearId,
        provision,
      }),
    );
    expect(result.invited).toBe(true);
    expect(provision).toHaveBeenCalledOnce();
    const user = await migratorDb.user.findUniqueOrThrow({ where: { email } });
    expect((await migratorDb.person.findUniqueOrThrow({ where: { id: studentId } })).userId).toBe(
      user.id,
    );
    const rep = await grantsOf(user.id, "section", section.id);
    expect(rep.map((g) => g.role.key).sort()).toEqual(["student", "student_rep"]);
    expect(rep.every((g) => g.validTo === null)).toBe(true);

    // a second open primary violates section_rep_primary (raw insert bypassing the service)
    await expect(
      migratorDb.sectionRepresentative.create({
        data: {
          departmentId: DEPT_CS,
          sectionId: section.id,
          studentId: other,
          academicYearId: section.academicYearId,
          validFrom: new Date(),
          isPrimary: true,
        },
      }),
    ).rejects.toThrow(/section_rep_primary|Unique constraint/);

    // the service replaces the primary instead: the old grant closes
    await withDept(DEPT_CS, (tx) =>
      assignRepresentative(tx, DEPT_CS, {
        sectionId: section.id,
        studentId: other,
        academicYearId: section.academicYearId,
      }),
    );
    const closed = await grantsOf(user.id, "section", section.id);
    expect(closed.find((g) => g.role.key === "student_rep")?.validTo).toBeInstanceOf(Date);
    expect(closed.find((g) => g.role.key === "student")?.validTo).toBeNull();
  });
});
