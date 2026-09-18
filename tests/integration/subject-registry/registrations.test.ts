import { describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import * as registry from "@/platform/subject-registry";
import { assignTeaching } from "@/platform/academic/teaching";
import { enrollSectionMembers } from "@/platform/academic/enrollment";
import { upsertResource } from "@/platform/academic/resources";
import { assignRepresentative } from "@/platform/people/representatives";
import { withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

const ref = (subjectType: string, subjectId: string) => ({ subjectType, subjectId });

const TYPES = [
  "department",
  "person",
  "staff_profile",
  "student",
  "program",
  "section",
  "group",
  "group_membership",
  "section_representative",
  "student_section_membership",
  "academic_year",
  "term",
  "calendar_period",
  "course",
  "course_offering",
  "section_offering",
  "teaching_assignment",
  "enrollment",
  "resource",
] as const;

describe("subject registrations of the people and academic services", () => {
  it("registers every registry subject type", () => {
    for (const t of TYPES) expect(registry.isRegistered(t), t).toBe(true);
  });

  it("resolves labels, snapshots, contexts, relationships, variables and urls over real rows", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const teacher = await f.staff(tx, DEPT_CS, { fullName: "Reg Teacher" });
      const section = await f.section(tx, DEPT_CS, { code: "REG-A" });
      const st = await f.student(tx, DEPT_CS, { sectionId: section.id, fullName: "Reg Student" });
      const stranger = await f.student(tx, DEPT_CS, { fullName: "Stranger" });
      const { offering, sectionOfferings } = await f.offering(tx, DEPT_CS, {
        sectionIds: [section.id],
      });
      const so = sectionOfferings[0]!;
      await tx.courseOffering.update({
        where: { id: offering.id },
        data: { coordinatorPersonId: teacher.id },
      });
      const ta = await assignTeaching(tx, DEPT_CS, {
        sectionOfferingId: so.id,
        personId: teacher.id,
        role: "lab",
      });
      await enrollSectionMembers(tx, DEPT_CS, so.id);
      const enrollment = await tx.enrollment.findFirstOrThrow({
        where: { sectionOfferingId: so.id },
      });
      const { representative } = await assignRepresentative(tx, DEPT_CS, {
        sectionId: section.id,
        studentId: st.id,
        academicYearId: section.academicYearId,
      });
      const membership = await tx.studentSectionMembership.findFirstOrThrow({
        where: { studentId: st.id },
      });
      const { group, memberships } = await f.committee(tx, DEPT_CS, [
        { personId: teacher.id, role: "chair" },
      ]);
      const resource = await upsertResource(tx, DEPT_CS, {
        code: `RES-${f.uniqueSuffix()}`,
        name: "Reg Room",
        kind: "classroom",
        responsiblePersonId: teacher.id,
        location: "B1",
      });
      const term = await f.currentTermOf(tx, DEPT_CS);
      const period = await tx.calendarPeriod.findFirstOrThrow({
        where: { termId: term.id, kind: "add_drop" },
      });
      const year = await f.currentYear(tx, DEPT_CS);
      const program = await tx.program.findUniqueOrThrow({ where: { id: section.programId } });
      const course = await tx.course.findUniqueOrThrow({ where: { id: offering.courseId } });
      const ids: Record<(typeof TYPES)[number], string> = {
        department: DEPT_CS,
        person: teacher.id,
        staff_profile: teacher.id,
        student: st.id,
        program: program.id,
        section: section.id,
        group: group.id,
        group_membership: memberships[0]!.id,
        section_representative: representative.id,
        student_section_membership: membership.id,
        academic_year: year.id,
        term: term.id,
        calendar_period: period.id,
        course: course.id,
        course_offering: offering.id,
        section_offering: so.id,
        teaching_assignment: ta.id,
        enrollment: enrollment.id,
        resource: resource.id,
      };

      // labels
      expect(await registry.label(tx, ref("department", DEPT_CS))).toBe("Computer Science");
      expect(await registry.label(tx, ref("person", teacher.id))).toBe("Reg Teacher");
      expect(await registry.label(tx, ref("staff_profile", teacher.id))).toBe("Reg Teacher");
      expect(await registry.label(tx, ref("student", st.id))).toBe("Reg Student");
      expect(await registry.label(tx, ref("program", program.id))).toBe(program.name);
      expect(await registry.label(tx, ref("section", section.id))).toBe("REG-A");
      expect(await registry.label(tx, ref("group", group.id))).toBe(group.name);
      expect(await registry.label(tx, ref("group_membership", memberships[0]!.id))).toContain(
        "Reg Teacher in",
      );
      expect(await registry.label(tx, ref("section_representative", representative.id))).toBe(
        "Reg Student (REG-A)",
      );
      expect(await registry.label(tx, ref("student_section_membership", membership.id))).toBe(
        "Reg Student in REG-A",
      );
      expect(await registry.label(tx, ref("academic_year", year.id))).toBe(year.code);
      expect(await registry.label(tx, ref("term", term.id))).toBe(`${term.name} ${year.code}`);
      expect(await registry.label(tx, ref("calendar_period", period.id))).toBe(period.label);
      expect(await registry.label(tx, ref("course", course.id))).toBe(
        `${course.code} ${course.title}`,
      );
      expect(await registry.label(tx, ref("course_offering", offering.id))).toBe(
        `${course.code} (${term.name})`,
      );
      expect(await registry.label(tx, ref("section_offering", so.id))).toBe(`${course.code} REG-A`);
      expect(await registry.label(tx, ref("teaching_assignment", ta.id))).toContain("Reg Teacher:");
      expect(await registry.label(tx, ref("enrollment", enrollment.id))).toBe(
        "Reg Student (enrolled)",
      );
      expect(await registry.label(tx, ref("resource", resource.id))).toBe(
        `${resource.code} Reg Room`,
      );

      // snapshots exist; unknown ids resolve to nothing everywhere
      for (const t of TYPES) {
        expect((await registry.snapshot(tx, ref(t, ids[t])))?.label, t).toBeTruthy();
        expect(await registry.exists(tx, ref(t, "nope")), t).toBe(false);
        expect(await registry.label(tx, ref(t, "nope")), t).toBe(`${t} nope`);
        expect(await registry.contextOf(tx, ref(t, "nope")), t).toEqual(
          t === "department"
            ? { departmentId: "nope" }
            : t === "person"
              ? { ownerPersonId: "nope" }
              : {},
        );
        expect(await registry.relationships(tx, ref(t, "nope"), teacher.id), t).toEqual([]);
        expect(await registry.variables(tx, ref(t, "nope")), t).toEqual({});
      }
      // contexts with inheritance
      expect(await registry.contextOf(tx, ref("teaching_assignment", ta.id))).toMatchObject({
        departmentId: DEPT_CS,
        ownerPersonId: teacher.id,
        sectionOfferingId: so.id,
        sectionId: section.id,
        termId: term.id,
      });
      expect(await registry.contextOf(tx, ref("enrollment", enrollment.id))).toMatchObject({
        ownerPersonId: st.id,
        sectionOfferingId: so.id,
        termId: term.id,
      });
      expect(await registry.contextOf(tx, ref("calendar_period", period.id))).toMatchObject({
        departmentId: DEPT_CS,
        termId: term.id,
      });
      expect(await registry.contextOf(tx, ref("group", group.id))).toMatchObject({
        groupId: group.id,
        committeeId: group.id,
      });
      expect(
        await registry.contextOf(tx, ref("group_membership", memberships[0]!.id)),
      ).toMatchObject({ ownerPersonId: teacher.id, groupId: group.id, committeeId: group.id });
      expect(await registry.contextOf(tx, ref("student", st.id))).toMatchObject({
        ownerPersonId: st.id,
        programId: program.id,
      });
      expect(await registry.contextOf(tx, ref("course", course.id))).toMatchObject({
        departmentId: DEPT_CS,
      });
      expect(await registry.contextOf(tx, ref("course_offering", offering.id))).toMatchObject({
        termId: term.id,
        ownerPersonId: teacher.id,
      });
      expect(await registry.contextOf(tx, ref("resource", resource.id))).toMatchObject({
        ownerPersonId: teacher.id,
      });
      expect(
        await registry.contextOf(tx, ref("section_representative", representative.id)),
      ).toMatchObject({ sectionId: section.id });
      expect(
        await registry.contextOf(tx, ref("student_section_membership", membership.id)),
      ).toMatchObject({ sectionId: section.id });
      expect(await registry.contextOf(tx, ref("academic_year", year.id))).toEqual({
        departmentId: DEPT_CS,
      });
      expect(await registry.contextOf(tx, ref("staff_profile", teacher.id))).toMatchObject({
        ownerPersonId: teacher.id,
      });
      expect(await registry.contextOf(tx, ref("program", program.id))).toEqual({
        departmentId: DEPT_CS,
        programId: program.id,
      });

      // relationships
      expect(await registry.relationships(tx, ref("person", teacher.id), teacher.id)).toEqual([
        "owner",
      ]);
      expect(
        await registry.relationships(tx, ref("staff_profile", teacher.id), teacher.id),
      ).toEqual(["owner"]);
      expect(await registry.relationships(tx, ref("student", st.id), st.id)).toEqual(["owner"]);
      expect(await registry.relationships(tx, ref("section", section.id), st.id)).toEqual([
        "section_rep",
        "member",
      ]);
      expect(await registry.relationships(tx, ref("section", section.id), stranger.id)).toEqual([]);
      expect(await registry.relationships(tx, ref("section", section.id), null)).toEqual([]);
      expect(await registry.relationships(tx, ref("group", group.id), teacher.id)).toEqual([
        "member",
        "chair",
      ]);
      expect(await registry.relationships(tx, ref("group", group.id), null)).toEqual([]);
      expect(
        await registry.relationships(tx, ref("group_membership", memberships[0]!.id), teacher.id),
      ).toEqual(["owner"]);
      expect(
        await registry.relationships(tx, ref("section_representative", representative.id), st.id),
      ).toEqual(["owner"]);
      expect(
        await registry.relationships(tx, ref("student_section_membership", membership.id), st.id),
      ).toEqual(["owner"]);
      expect(
        await registry.relationships(tx, ref("course_offering", offering.id), teacher.id),
      ).toEqual(["owner", "assignee"]);
      expect(await registry.relationships(tx, ref("course_offering", offering.id), null)).toEqual(
        [],
      );
      expect(await registry.relationships(tx, ref("section_offering", so.id), teacher.id)).toEqual([
        "assignee",
      ]);
      expect(await registry.relationships(tx, ref("section_offering", so.id), st.id)).toEqual([
        "section_rep",
        "participant",
      ]);
      expect(await registry.relationships(tx, ref("section_offering", so.id), null)).toEqual([]);
      expect(
        await registry.relationships(tx, ref("teaching_assignment", ta.id), teacher.id),
      ).toEqual(["owner", "assignee"]);
      expect(await registry.relationships(tx, ref("enrollment", enrollment.id), st.id)).toEqual([
        "owner",
      ]);
      expect(await registry.relationships(tx, ref("resource", resource.id), teacher.id)).toEqual([
        "owner",
      ]);
      expect(await registry.relationships(tx, ref("resource", resource.id), null)).toEqual([]);
      expect(await registry.relationships(tx, ref("program", program.id), teacher.id)).toEqual([]);

      // variables and urls
      expect(await registry.variables(tx, ref("person", teacher.id))).toMatchObject({
        person_name: "Reg Teacher",
      });
      expect(await registry.variables(tx, ref("term", term.id))).toEqual({
        term_name: term.name,
        academic_year: year.code,
      });
      expect(await registry.variables(tx, ref("course", course.id))).toEqual({
        course_code: course.code,
        course_name: course.title,
      });
      expect(await registry.variables(tx, ref("course_offering", offering.id))).toMatchObject({
        course_code: course.code,
        term_name: term.name,
      });
      expect(await registry.variables(tx, ref("resource", resource.id))).toEqual({
        resource_code: resource.code,
        resource_name: "Reg Room",
        resource_location: "B1",
      });
      expect(registry.url(ref("course_offering", offering.id), "cs")).toBe(
        `/d/cs/offerings/${offering.id}`,
      );
      expect(registry.url(ref("section_offering", so.id), "cs")).toBe(`/d/cs/offerings/${so.id}`);
      expect(registry.url(ref("person", teacher.id), "cs")).toBe(`/d/cs/people/${teacher.id}`);
      expect(registry.url(ref("staff_profile", teacher.id), "cs")).toBe(
        `/d/cs/people/${teacher.id}`,
      );
      expect(registry.url(ref("student", st.id), "cs")).toBe(`/d/cs/people/${st.id}`);
      expect(registry.url(ref("department", DEPT_CS), "cs")).toBe("/d/cs");
      expect(registry.url(ref("program", program.id), "cs")).toBe("/d/cs/programs");
      expect(registry.url(ref("section", section.id), "cs")).toBe("/d/cs/sections");
      expect(registry.url(ref("academic_year", year.id), "cs")).toBe("/d/cs/calendar");
      expect(registry.url(ref("term", term.id), "cs")).toBe("/d/cs/calendar");
      expect(registry.url(ref("course", course.id), "cs")).toBe("/d/cs/courses");
      expect(registry.url(ref("resource", resource.id), "cs")).toBe("/d/cs/resources");
      expect(registry.url(ref("group", group.id), "cs")).toBeNull();
    });
  });
});
