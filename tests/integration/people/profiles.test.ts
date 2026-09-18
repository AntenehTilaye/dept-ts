import { describe, expect, it, vi } from "vitest";
import {
  createPerson,
  detachFromDepartment,
  findPersonByEmail,
  getPerson,
  searchPersons,
  updatePerson,
} from "@/platform/people/persons";
import {
  deleteProfileItem,
  getStaffProfile,
  listStaff,
  profileItemsOf,
  upsertProfileItem,
  upsertStaffProfile,
} from "@/platform/people/staff";
import {
  currentSectionMembership,
  getStudent,
  setSectionMembership,
  studentsInSection,
  upsertStudent,
} from "@/platform/people/students";
import { getGroup, groupsOf, isChair, membersOf, removeMember } from "@/platform/people/groups";
import {
  endRepresentative,
  assignRepresentative,
  representativesOf,
} from "@/platform/people/representatives";
import { resolveAudience } from "@/platform/people/audience";
import { withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });

describe("persons and profiles", () => {
  it("creates, finds, updates with optimistic versioning and detaches persons", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const email = `Case.${f.uniqueSuffix()}@Deptts.local`;
      const p = await createPerson(tx, {
        fullName: "  Padded Name ",
        email,
        type: "external",
        organizationName: "ACME",
      });
      expect(p.fullName).toBe("Padded Name");
      expect(p.email).toBe(email.toLowerCase());
      expect((await findPersonByEmail(tx, email))?.id).toBe(p.id);
      expect((await getPerson(tx, p.id))?.organizationName).toBe("ACME");
      const u = await updatePerson(
        tx,
        p.id,
        { phone: "+251-1", roleLabel: "Guest", status: "inactive", email: null },
        1,
      );
      expect(u).toMatchObject({
        phone: "+251-1",
        roleLabel: "Guest",
        status: "inactive",
        rowVersion: 2,
        email: null,
      });
      await expect(updatePerson(tx, p.id, { fullName: "x" }, 1)).rejects.toThrow(
        /changed by someone else/,
      );
      await updatePerson(tx, p.id, { fullName: "Renamed", type: "staff" });
      expect((await getPerson(tx, p.id))?.fullName).toBe("Renamed");
    });
    const p = await withDept(DEPT_CS, (tx) => f.person(tx, DEPT_CS));
    await withDept(DEPT_CS, (tx) => detachFromDepartment(tx, DEPT_CS, p.id));
    expect(
      (await withDept(DEPT_CS, (tx) => searchPersons(tx, DEPT_CS))).some((x) => x.id === p.id),
    ).toBe(false);
    expect(
      (
        await withDept(DEPT_CS, (tx) =>
          searchPersons(tx, DEPT_CS, { includeLeft: true, limit: 500 }),
        )
      ).some((x) => x.id === p.id),
    ).toBe(true);
  });

  it("staff profiles and profile items", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const p = await f.person(tx, DEPT_CS);
      const sp = await upsertStaffProfile(tx, DEPT_CS, p.id, {
        staffId: ` X-${f.uniqueSuffix()} `,
        academicInterests: ["ml"],
        joinedAt: new Date("2021-01-01T00:00:00Z"),
      });
      expect(sp.staffId.startsWith("X-")).toBe(true);
      const sp2 = await upsertStaffProfile(tx, DEPT_CS, p.id, {
        staffId: sp.staffId,
        academicRank: "Professor",
      });
      expect(sp2).toMatchObject({
        rowVersion: 2,
        academicRank: "Professor",
        academicInterests: [],
      });
      expect((await getStaffProfile(tx, p.id))?.person.id).toBe(p.id);
      expect((await listStaff(tx, DEPT_CS)).some((s) => s.personId === p.id)).toBe(true);
      const item = await upsertProfileItem(tx, DEPT_CS, p.id, {
        kind: "training",
        title: " Course ",
        details: { hours: 8 },
      });
      expect(item.title).toBe("Course");
      const edited = await upsertProfileItem(tx, DEPT_CS, p.id, {
        id: item.id,
        kind: "training",
        title: "Course 2",
        dateFrom: new Date("2024-01-01T00:00:00Z"),
      });
      expect(edited.id).toBe(item.id);
      expect((await profileItemsOf(tx, p.id)).map((i) => i.title)).toEqual(["Course 2"]);
      await deleteProfileItem(tx, item.id);
      expect(await profileItemsOf(tx, p.id)).toEqual([]);
    });
  });

  it("students move between sections with time-bounded memberships", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const program = await f.program(tx, DEPT_CS);
      const a = await f.section(tx, DEPT_CS, { programId: program.id });
      const b = await f.section(tx, DEPT_CS, { programId: program.id });
      const st = await f.student(tx, DEPT_CS, { sectionId: a.id });
      expect((await getStudent(tx, st.id))?.program.id).toBe(program.id);
      const t1 = new Date("2026-10-01T00:00:00Z");
      const m1 = await setSectionMembership(tx, DEPT_CS, {
        studentId: st.id,
        sectionId: a.id,
        academicYearId: a.academicYearId,
        from: t1,
      });
      const moved = await setSectionMembership(tx, DEPT_CS, {
        studentId: st.id,
        sectionId: b.id,
        academicYearId: a.academicYearId,
        from: t1,
      });
      expect(moved.id).not.toBe(m1.id);
      expect(
        (await tx.studentSectionMembership.findUniqueOrThrow({ where: { id: m1.id } })).validTo,
      ).toEqual(t1);
      expect(
        (
          await currentSectionMembership(
            tx,
            st.id,
            a.academicYearId,
            new Date("2026-11-01T00:00:00Z"),
          )
        )?.sectionId,
      ).toBe(b.id);
      expect(
        (
          await currentSectionMembership(
            tx,
            st.id,
            a.academicYearId,
            new Date("2026-09-15T00:00:00Z"),
          )
        )?.sectionId,
      ).toBe(a.id);
      expect(
        (await studentsInSection(tx, b.id, new Date("2026-11-01T00:00:00Z"))).map(
          (s) => s.personId,
        ),
      ).toEqual([st.id]);
      expect(
        (await studentsInSection(tx, a.id, new Date("2026-11-01T00:00:00Z"))).map(
          (s) => s.personId,
        ),
      ).toEqual([]);
      await upsertStudent(tx, DEPT_CS, st.id, {
        studentNumber: "ST/NEW",
        programId: program.id,
        admissionYear: 2023,
        status: "graduated",
      });
      expect((await getStudent(tx, st.id))?.status).toBe("graduated");
      expect(
        (await resolveAudience(tx, DEPT_CS, { programs: [program.id] })).map((p) => p.id),
      ).toEqual([]);
      expect(
        (
          await resolveAudience(tx, DEPT_CS, { sections: [b.id] }, new Date("2026-11-01T00:00:00Z"))
        ).map((p) => p.id),
      ).toEqual([st.id]);
    });
  });

  it("group queries and representative listing", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const chair = await f.staff(tx, DEPT_CS);
      const member = await f.staff(tx, DEPT_CS);
      const { group } = await f.committee(tx, DEPT_CS, [
        { personId: chair.id, role: "chair" },
        { personId: member.id },
      ]);
      expect((await getGroup(tx, group.id))?.kind).toBe("committee");
      expect((await membersOf(tx, group.id)).map((m) => m.roleInGroup)).toEqual([
        "chair",
        "member",
      ]);
      expect((await groupsOf(tx, chair.id, "committee")).map((g) => g.group.id)).toEqual([
        group.id,
      ]);
      expect(await groupsOf(tx, chair.id, "section")).toEqual([]);
      expect(await removeMember(tx, DEPT_CS, group.id, member.id)).toBe(1);
      expect(await removeMember(tx, DEPT_CS, group.id, member.id)).toBe(0);
      expect((await membersOf(tx, group.id)).map((m) => m.personId)).toEqual([chair.id]);
      expect(isChair("lead")).toBe(true);
      expect(isChair("member")).toBe(false);
      expect((await resolveAudience(tx, DEPT_CS, { groups: [group.id] })).map((p) => p.id)).toEqual(
        [chair.id],
      );

      const section = await f.section(tx, DEPT_CS);
      const s1 = await f.student(tx, DEPT_CS, { sectionId: section.id });
      const s2 = await f.student(tx, DEPT_CS, { sectionId: section.id });
      const r1 = await assignRepresentative(tx, DEPT_CS, {
        sectionId: section.id,
        studentId: s1.id,
        academicYearId: section.academicYearId,
      });
      const again = await assignRepresentative(tx, DEPT_CS, {
        sectionId: section.id,
        studentId: s1.id,
        academicYearId: section.academicYearId,
      });
      expect(again.representative.id).toBe(r1.representative.id);
      const deputy = await assignRepresentative(tx, DEPT_CS, {
        sectionId: section.id,
        studentId: s2.id,
        academicYearId: section.academicYearId,
        isPrimary: false,
      });
      expect(
        (await representativesOf(tx, section.id, section.academicYearId)).map((r) => r.isPrimary),
      ).toEqual([true, false]);
      await endRepresentative(tx, DEPT_CS, deputy.representative.id);
      expect(
        (await representativesOf(tx, section.id, section.academicYearId)).map((r) => r.id),
      ).toEqual([r1.representative.id]);
    });
  });
});
