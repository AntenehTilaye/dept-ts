import { describe, expect, it, vi } from "vitest";
import { readManifest } from "../../../prisma/scripts/gen-rls";
import { attachToDepartment, mergePersons, searchPersons } from "@/platform/people/persons";
import { upsertStaffProfile } from "@/platform/people/staff";
import { resolveAudience, snapshotAudienceAsGroup } from "@/platform/people/audience";
import { contextOf, exists, label } from "@/platform/subject-registry";
import { bootstrap } from "@/lib/bootstrap";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

describe("persons are faculty-global, profiles are department-private", () => {
  it("one person linked to CS and EE is visible from both while the StaffProfile row stays with its department", async () => {
    const p = await withDept(DEPT_CS, (tx) =>
      f.staff(tx, DEPT_CS, { fullName: "Shared Lecturer" }),
    );
    await withDept(DEPT_EE, (tx) => attachToDepartment(tx, DEPT_EE, p.id));
    // findUnique on the same person id from both departments
    expect(
      (await withDept(DEPT_CS, (tx) => tx.person.findUnique({ where: { id: p.id } })))?.fullName,
    ).toBe("Shared Lecturer");
    expect(
      (await withDept(DEPT_EE, (tx) => tx.person.findUnique({ where: { id: p.id } })))?.fullName,
    ).toBe("Shared Lecturer");
    expect(
      await withDept(DEPT_EE, (tx) => tx.departmentPerson.count({ where: { personId: p.id } })),
    ).toBe(1);
    // the staff profile (one per person, owned by the employing department) is invisible to EE
    expect(
      await withDept(DEPT_CS, (tx) => tx.staffProfile.count({ where: { personId: p.id } })),
    ).toBe(1);
    expect(
      await withDept(DEPT_EE, (tx) => tx.staffProfile.count({ where: { personId: p.id } })),
    ).toBe(0);
    // and EE cannot take it over: the upsert hits the CS row, which RLS refuses
    await expect(
      withDept(DEPT_EE, (tx) => upsertStaffProfile(tx, DEPT_EE, p.id, { staffId: "EE-SHARED" })),
    ).rejects.toThrow(/row-level security|Unique constraint/);
    expect(
      (await migratorDb.staffProfile.findUniqueOrThrow({ where: { personId: p.id } })).departmentId,
    ).toBe(DEPT_CS);
  });

  it("directory search finds by partial name (trigram) and email, only within the department", async () => {
    const p = await withDept(DEPT_CS, (tx) =>
      f.staff(tx, DEPT_CS, { fullName: "Instructor Zebra Quokka", email: "zebra.q@deptts.local" }),
    );
    const byName = await withDept(DEPT_CS, (tx) => searchPersons(tx, DEPT_CS, { q: "zebra" }));
    expect(byName.map((x) => x.id)).toContain(p.id);
    const bySimilarity = await withDept(DEPT_CS, (tx) =>
      searchPersons(tx, DEPT_CS, { q: "Zebra Qukka" }),
    );
    expect(bySimilarity.map((x) => x.id)).toContain(p.id);
    const byEmail = await withDept(DEPT_CS, (tx) => searchPersons(tx, DEPT_CS, { q: "zebra.q@" }));
    expect(byEmail.map((x) => x.id)).toContain(p.id);
    const fromEe = await withDept(DEPT_EE, (tx) => searchPersons(tx, DEPT_EE, { q: "zebra" }));
    expect(fromEe.map((x) => x.id)).not.toContain(p.id);
    const staffOnly = await withDept(DEPT_CS, (tx) =>
      searchPersons(tx, DEPT_CS, { type: "student" }),
    );
    expect(staffOnly.map((x) => x.id)).not.toContain(p.id);
  });

  it("classifies person as GLOBAL and department_person as TENANT", () => {
    const m = readManifest()!;
    expect(m.global.some((e) => e.table === "person")).toBe(true);
    expect(m.tenant.some((e) => e.table === "department_person")).toBe(true);
    expect(m.tenant.some((e) => e.table === "staff_profile")).toBe(true);
  });

  it("merges a duplicate person into the kept one", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const keep = await f.staff(tx, DEPT_CS);
      const dup = await f.staff(tx, DEPT_CS);
      const { group } = await f.committee(tx, DEPT_CS, [{ personId: dup.id }]);
      await mergePersons(tx, keep.id, dup.id);
      const members = await tx.groupMembership.findMany({ where: { groupId: group.id } });
      expect(members.map((m) => m.personId)).toEqual([keep.id]);
      expect((await tx.person.findUniqueOrThrow({ where: { id: dup.id } })).status).toBe(
        "inactive",
      );
      expect(await tx.departmentPerson.count({ where: { personId: dup.id } })).toBe(0);
    });
  });

  it("subject registry resolves people and academic subjects through a department client", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const s = await f.section(tx, DEPT_CS);
      const st = await f.student(tx, DEPT_CS, { sectionId: s.id });
      expect(await exists(tx, { subjectType: "section", subjectId: s.id })).toBe(true);
      expect(await exists(tx, { subjectType: "section", subjectId: "nope" })).toBe(false);
      expect(await label(tx, { subjectType: "student", subjectId: st.id })).toBe(
        (await tx.person.findUniqueOrThrow({ where: { id: st.id } })).fullName,
      );
      expect(await contextOf(tx, { subjectType: "section", subjectId: s.id })).toMatchObject({
        departmentId: DEPT_CS,
        sectionId: s.id,
        groupId: s.groupId,
      });
      const { group, personIds } = await snapshotAudienceAsGroup(
        tx,
        DEPT_CS,
        { sections: [s.id] },
        { subjectType: "meeting", subjectId: "m1" },
      );
      expect(personIds).toEqual([st.id]);
      expect(await contextOf(tx, { subjectType: "group", subjectId: group.id })).toMatchObject({
        departmentId: DEPT_CS,
        groupId: group.id,
      });
      expect((await resolveAudience(tx, DEPT_CS, { groups: [group.id] })).map((p) => p.id)).toEqual(
        [st.id],
      );
    });
  });
});
