import { describe, expect, it, vi } from "vitest";
import { courseLineage, listOfferingsOfCourse } from "@/platform/academic/courses";
import {
  ensureOffering,
  ensureSectionOffering,
  isSectionLocked,
  lockSectionAssessment,
  recomputeSchemeStructureLock,
} from "@/platform/academic/offerings";
import { assignTeaching, endTeaching, teachingOf } from "@/platform/academic/teaching";
import {
  applyEnrollmentDecision,
  enrollSectionMembers,
  roster,
} from "@/platform/academic/enrollment";
import { resolveTermAnchor, setPeriod } from "@/platform/academic/calendar";
import { resolveAudience } from "@/platform/people/audience";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });

describe("academic registry", () => {
  it("ensureOffering and ensureSectionOffering are idempotent per key", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const c = await f.course(tx, DEPT_CS);
      const term = await f.currentTermOf(tx, DEPT_CS);
      const a = await ensureOffering(tx, DEPT_CS, { courseId: c.id, termId: term.id });
      const b = await ensureOffering(tx, DEPT_CS, { courseId: c.id, termId: term.id });
      expect(b.id).toBe(a.id);
      const s = await f.section(tx, DEPT_CS);
      const so1 = await ensureSectionOffering(tx, DEPT_CS, {
        courseOfferingId: a.id,
        sectionId: s.id,
      });
      const so2 = await ensureSectionOffering(tx, DEPT_CS, {
        courseOfferingId: a.id,
        sectionId: s.id,
      });
      expect(so2.id).toBe(so1.id);
      expect(so1.sectionCode).toBe(s.code);
    });
  });

  it("assignTeaching derives instructor@section_offering and endTeaching closes it", async () => {
    const user = await migratorDb.user.findUniqueOrThrow({
      where: { email: "instructor2.cs@deptts.local" },
    });
    const { ta, so } = await withDept(DEPT_CS, async (tx) => {
      const p = await f.staff(tx, DEPT_CS, {
        userId: user.id,
        email: "instructor2.cs@deptts.local",
      });
      const s = await f.section(tx, DEPT_CS);
      const { sectionOfferings } = await f.offering(tx, DEPT_CS, { sectionIds: [s.id] });
      const so = sectionOfferings[0]!;
      const ta = await assignTeaching(tx, DEPT_CS, {
        sectionOfferingId: so.id,
        personId: p.id,
        role: "lecture",
      });
      expect(
        (
          await assignTeaching(tx, DEPT_CS, {
            sectionOfferingId: so.id,
            personId: p.id,
            role: "lecture",
          })
        ).id,
      ).toBe(ta.id);
      expect((await teachingOf(tx, p.id)).map((t) => t.id)).toEqual([ta.id]);
      // audience: teachingIn resolves the instructor
      expect((await resolveAudience(tx, DEPT_CS, { teachingIn: so.id })).map((x) => x.id)).toEqual([
        p.id,
      ]);
      return { ta, so };
    });
    const grant = await withDept(DEPT_CS, (tx) =>
      tx.roleGrant.findFirst({
        where: { userId: user.id, scopeType: "section_offering", scopeId: so.id },
        include: { role: true },
      }),
    );
    expect(grant).toMatchObject({
      role: { key: "instructor" },
      derivedFromType: "teaching_assignment",
      derivedFromId: ta.id,
      validTo: null,
    });
    await withDept(DEPT_CS, (tx) => endTeaching(tx, DEPT_CS, ta.id));
    const closed = await withDept(DEPT_CS, (tx) =>
      tx.roleGrant.findFirst({ where: { derivedFromId: ta.id } }),
    );
    expect(closed?.validTo).toBeInstanceOf(Date);
  });

  it("enrolls section members once, keeps enrollment unique and refreshes the count cache", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const s = await f.section(tx, DEPT_CS);
      const a = await f.student(tx, DEPT_CS, { sectionId: s.id });
      await f.student(tx, DEPT_CS, { sectionId: s.id });
      const { sectionOfferings } = await f.offering(tx, DEPT_CS, { sectionIds: [s.id] });
      const so = sectionOfferings[0]!;
      expect(await enrollSectionMembers(tx, DEPT_CS, so.id)).toBe(2);
      expect(await enrollSectionMembers(tx, DEPT_CS, so.id)).toBe(0);
      await applyEnrollmentDecision(tx, DEPT_CS, {
        sectionOfferingId: so.id,
        studentId: a.id,
        status: "dropped",
        source: "add_drop_decision",
      });
      const rows = await roster(tx, so.id);
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.studentId === a.id)?.status).toBe("dropped");
      expect(
        (await tx.sectionOffering.findUniqueOrThrow({ where: { id: so.id } })).enrolledCount,
      ).toBe(1);
      expect(
        (await resolveAudience(tx, DEPT_CS, { sectionOfferings: [so.id] })).map((p) => p.id),
      ).not.toContain(a.id);
    });
  });

  it("locks one section's assessment only and caches the scheme lock on the offering", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const s1 = await f.section(tx, DEPT_CS);
      const s2 = await f.section(tx, DEPT_CS);
      const { offering, sectionOfferings } = await f.offering(tx, DEPT_CS, {
        sectionIds: [s1.id, s2.id],
      });
      await lockSectionAssessment(tx, sectionOfferings[0]!.id, "portfolio-1");
      expect(await isSectionLocked(tx, sectionOfferings[0]!.id)).toBe(true);
      expect(await isSectionLocked(tx, sectionOfferings[1]!.id)).toBe(false);
      const o = await recomputeSchemeStructureLock(tx, offering.id);
      expect(o.schemeStructureLockedAt).toBeInstanceOf(Date);
    });
  });

  it("walks course lineage across years and lists offerings of predecessors", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const v1 = await f.course(tx, DEPT_CS);
      const v2 = await f.course(tx, DEPT_CS, { predecessorCourseId: v1.id });
      const v3 = await f.course(tx, DEPT_CS, { predecessorCourseId: v2.id });
      expect((await courseLineage(tx, v3.id)).map((c) => c.id)).toEqual([v3.id, v2.id, v1.id]);
      const year = await f.currentYear(tx, DEPT_CS);
      const prev = await tx.academicYear.findFirstOrThrow({
        where: { departmentId: DEPT_CS, NOT: { id: year.id } },
      });
      const prevTerm = await tx.term.findFirstOrThrow({ where: { academicYearId: prev.id } });
      await f.offering(tx, DEPT_CS, { courseId: v1.id, termId: prevTerm.id });
      await f.offering(tx, DEPT_CS, { courseId: v3.id });
      const all = await listOfferingsOfCourse(tx, v3.id);
      expect(all.map((o) => o.courseId)).toEqual([v3.id, v1.id]);
      expect((await listOfferingsOfCourse(tx, v3.id, false)).map((o) => o.courseId)).toEqual([
        v3.id,
      ]);
    });
  });

  it("resolves calendar anchors against the seeded periods and validates period edits", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const term = await f.currentTermOf(tx, DEPT_CS);
      const end = await resolveTermAnchor(tx, term.id, {
        periodKind: "add_drop",
        edge: "end",
        offsetDays: -1,
      });
      expect(end.toISOString()).toBe("2026-09-27T17:00:00.000Z");
      await expect(
        setPeriod(tx, DEPT_CS, {
          termId: term.id,
          kind: "custom",
          label: "bad",
          startAt: new Date("2026-10-02T00:00:00Z"),
          endAt: new Date("2026-10-01T00:00:00Z"),
        }),
      ).rejects.toThrow(/end after/);
      await expect(
        setPeriod(tx, DEPT_CS, {
          termId: term.id,
          kind: "custom",
          label: "out",
          startAt: new Date("2028-01-01T00:00:00Z"),
          endAt: new Date("2028-01-02T00:00:00Z"),
        }),
      ).rejects.toThrow(/academic year/);
    });
  });
});
