import { describe, expect, it, vi } from "vitest";
import {
  createAcademicYear,
  createTerm,
  currentTerm,
  deletePeriod,
  listYears,
  quarterOfDate,
  setCurrentTerm,
  setPeriod,
  setPeriodDependentsResolver,
  previewPeriodImpact,
  setYearStatus,
} from "@/platform/academic/calendar";
import {
  listCourses,
  listPrograms,
  upsertCourse,
  upsertProgram,
} from "@/platform/academic/courses";
import {
  getOffering,
  listOfferings,
  unlockSectionAssessment,
  lockSectionAssessment,
  isSectionLocked,
  ensureOffering,
} from "@/platform/academic/offerings";
import { getResource, listResources, upsertResource } from "@/platform/academic/resources";
import { slotsOfTerm, upsertTimetableSlots, validateSlot } from "@/platform/academic/timetable";
import { assignTeaching, teachersOfSection } from "@/platform/academic/teaching";
import { withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });

describe("calendar", () => {
  it("creates years and terms with validation, switches the current term and answers quarters", async () => {
    await withDept(DEPT_CS, async (tx) => {
      await expect(
        createAcademicYear(tx, DEPT_CS, {
          code: "bad",
          startDate: new Date("2030-01-01"),
          endDate: new Date("2029-01-01"),
        }),
      ).rejects.toThrow(/end after/);
      const y = await createAcademicYear(tx, DEPT_CS, {
        code: `T${f.uniqueSuffix()}`,
        startDate: new Date("2030-09-01T00:00:00Z"),
        endDate: new Date("2031-06-30T00:00:00Z"),
      });
      expect(y.status).toBe("planned");
      await expect(
        createTerm(tx, DEPT_CS, {
          academicYearId: y.id,
          ordinal: "first",
          name: "x",
          startDate: new Date("2029-01-01"),
          endDate: new Date("2030-10-01"),
        }),
      ).rejects.toThrow(/inside its academic year/);
      const t1 = await createTerm(tx, DEPT_CS, {
        academicYearId: y.id,
        ordinal: "first",
        name: "Sem I",
        startDate: new Date("2030-09-01T00:00:00Z"),
        endDate: new Date("2031-01-31T00:00:00Z"),
      });
      const before = await currentTerm(tx, DEPT_CS);
      await setCurrentTerm(tx, DEPT_CS, t1.id);
      const now = await currentTerm(tx, DEPT_CS);
      expect(now?.id).toBe(t1.id);
      expect(now?.academicYear.status).toBe("active");
      expect((await tx.term.findUniqueOrThrow({ where: { id: before!.id } })).status).toBe(
        "closed",
      );
      expect(
        (await tx.academicYear.findUniqueOrThrow({ where: { id: before!.academicYearId } })).status,
      ).toBe("closed");
      expect(await quarterOfDate(tx, y.id, new Date("2030-09-15T00:00:00Z"))).toBe(1);
      expect(await quarterOfDate(tx, y.id, new Date("2031-06-30T00:00:00Z"))).toBe(4);
      expect(await quarterOfDate(tx, y.id, new Date("2032-01-01T00:00:00Z"))).toBeNull();
      await setYearStatus(tx, y.id, "closed");
      expect((await listYears(tx, DEPT_CS)).find((x) => x.id === y.id)?.status).toBe("closed");
      await setCurrentTerm(tx, DEPT_CS, before!.id);
    });
  });

  it("periods report dependents through the resolver hook and can be deleted", async () => {
    setPeriodDependentsResolver(async (_db, periodId) => [
      { kind: "reminder", id: "r1", label: `reminder on ${periodId}` },
    ]);
    try {
      await withDept(DEPT_CS, async (tx) => {
        const term = await f.currentTermOf(tx, DEPT_CS);
        const { period, dependents } = await setPeriod(tx, DEPT_CS, {
          termId: term.id,
          kind: "custom",
          label: "Hackathon",
          startAt: new Date("2026-11-01T08:00:00Z"),
          endAt: new Date("2026-11-02T17:00:00Z"),
        });
        expect(dependents).toHaveLength(1);
        expect(await previewPeriodImpact(tx, period.id)).toEqual(dependents);
        const moved = await setPeriod(tx, DEPT_CS, {
          id: period.id,
          termId: term.id,
          kind: "custom",
          label: "Hackathon",
          startAt: new Date("2026-11-03T08:00:00Z"),
          endAt: new Date("2026-11-04T17:00:00Z"),
        });
        expect(moved.period.id).toBe(period.id);
        await deletePeriod(tx, period.id);
        expect(await tx.calendarPeriod.findUnique({ where: { id: period.id } })).toBeNull();
      });
    } finally {
      setPeriodDependentsResolver(async () => []);
    }
  });
});

describe("courses, offerings, resources and timetable", () => {
  it("lists programs and courses, updates in place and rejects self-lineage", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const p = await upsertProgram(tx, DEPT_CS, {
        code: "upd",
        name: "Upd",
        degreeLevel: "BSc",
        durationYears: 3,
      });
      expect(p.code).toBe("UPD");
      const p2 = await upsertProgram(tx, DEPT_CS, {
        id: p.id,
        code: "upd",
        name: "Updated",
        degreeLevel: "MSc",
        durationYears: 2,
      });
      expect(p2).toMatchObject({ id: p.id, name: "Updated" });
      expect((await listPrograms(tx, DEPT_CS)).some((x) => x.id === p.id)).toBe(true);
      const c = await f.course(tx, DEPT_CS);
      await expect(
        upsertCourse(tx, DEPT_CS, {
          id: c.id,
          code: c.code,
          title: "t",
          creditHours: 3,
          courseType: "core",
          predecessorCourseId: c.id,
        }),
      ).rejects.toThrow(/own predecessor/);
      const retired = await upsertCourse(tx, DEPT_CS, {
        id: c.id,
        code: c.code,
        title: "Retired",
        creditHours: 3,
        courseType: "core",
        status: "retired",
      });
      expect(retired.status).toBe("retired");
      expect((await listCourses(tx, DEPT_CS)).some((x) => x.id === c.id)).toBe(false);
      expect(
        (await listCourses(tx, DEPT_CS, { includeRetired: true })).some((x) => x.id === c.id),
      ).toBe(true);
    });
  });

  it("offering detail, listing, coordinator update and unlock", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const teacher = await f.staff(tx, DEPT_CS);
      const s = await f.section(tx, DEPT_CS);
      const { offering, sectionOfferings } = await f.offering(tx, DEPT_CS, { sectionIds: [s.id] });
      const updated = await ensureOffering(tx, DEPT_CS, {
        courseId: offering.courseId,
        termId: offering.termId,
        coordinatorPersonId: teacher.id,
      });
      expect(updated.coordinatorPersonId).toBe(teacher.id);
      await assignTeaching(tx, DEPT_CS, {
        sectionOfferingId: sectionOfferings[0]!.id,
        personId: teacher.id,
        role: "tutorial",
      });
      const detail = await getOffering(tx, offering.id);
      expect(detail?.sectionOfferings[0]?.teachingAssignments[0]?.person.id).toBe(teacher.id);
      expect((await teachersOfSection(tx, sectionOfferings[0]!.id)).map((t) => t.personId)).toEqual(
        [teacher.id],
      );
      const list = await listOfferings(tx, DEPT_CS, offering.termId);
      expect(list.find((o) => o.id === offering.id)?._count.sectionOfferings).toBe(1);
      expect((await listOfferings(tx, DEPT_CS)).some((o) => o.id === offering.id)).toBe(true);
      await lockSectionAssessment(tx, sectionOfferings[0]!.id, "pf");
      await lockSectionAssessment(tx, sectionOfferings[0]!.id, "pf-again");
      expect(
        (await tx.sectionOffering.findUniqueOrThrow({ where: { id: sectionOfferings[0]!.id } }))
          .assessmentLockedByPortfolioId,
      ).toBe("pf");
      await unlockSectionAssessment(tx, sectionOfferings[0]!.id);
      expect(await isSectionLocked(tx, sectionOfferings[0]!.id)).toBe(false);
      expect(await getOffering(tx, "nope")).toBeNull();
    });
  });

  it("resources upsert, list by kind and get", async () => {
    await withDept(DEPT_CS, async (tx) => {
      const code = `LAB-${f.uniqueSuffix()}`;
      const r = await upsertResource(tx, DEPT_CS, {
        code: code.toLowerCase(),
        name: "Lab",
        kind: "computer_lab",
        computerCount: 20,
        softwareList: ["R"],
        attributes: { projector: true },
      });
      expect(r.code).toBe(code.toUpperCase());
      const r2 = await upsertResource(tx, DEPT_CS, {
        id: r.id,
        code,
        name: "Lab 2",
        kind: "computer_lab",
        status: "maintenance",
      });
      expect(r2).toMatchObject({
        id: r.id,
        name: "Lab 2",
        status: "maintenance",
        softwareList: [],
      });
      expect((await listResources(tx, DEPT_CS, "computer_lab")).some((x) => x.id === r.id)).toBe(
        true,
      );
      expect((await listResources(tx, DEPT_CS, "office")).some((x) => x.id === r.id)).toBe(false);
      expect((await getResource(tx, r.id))?.name).toBe("Lab 2");
    });
  });

  it("timetable slots validate, replace per section offering and list with filters", async () => {
    expect(
      validateSlot({ sectionOfferingId: "x", weekday: 8, startTime: "9:00", endTime: "08:00" }),
    ).toHaveLength(2);
    expect(
      validateSlot({ sectionOfferingId: "x", weekday: 1, startTime: "10:00", endTime: "09:00" }),
    ).toEqual(["the slot must end after it starts"]);
    await withDept(DEPT_CS, async (tx) => {
      const teacher = await f.staff(tx, DEPT_CS);
      const s = await f.section(tx, DEPT_CS);
      const { offering, sectionOfferings } = await f.offering(tx, DEPT_CS, { sectionIds: [s.id] });
      const so = sectionOfferings[0]!;
      const ta = await assignTeaching(tx, DEPT_CS, {
        sectionOfferingId: so.id,
        personId: teacher.id,
        role: "lecture",
      });
      const room = await upsertResource(tx, DEPT_CS, {
        code: `R-${f.uniqueSuffix()}`,
        name: "Room",
        kind: "classroom",
      });
      await expect(
        upsertTimetableSlots(tx, DEPT_CS, offering.termId, [
          { sectionOfferingId: so.id, weekday: 0, startTime: "08:00", endTime: "09:00" },
        ]),
      ).rejects.toThrow(/slot 1/);
      expect(
        await upsertTimetableSlots(tx, DEPT_CS, offering.termId, [
          {
            sectionOfferingId: so.id,
            teachingAssignmentId: ta.id,
            resourceId: room.id,
            weekday: 1,
            startTime: "08:00",
            endTime: "10:00",
          },
          {
            sectionOfferingId: so.id,
            weekday: 3,
            startTime: "14:00",
            endTime: "16:00",
            weekPattern: "odd",
          },
        ]),
      ).toBe(2);
      expect(
        (await slotsOfTerm(tx, offering.termId, { personId: teacher.id })).map((x) => x.weekday),
      ).toEqual([1]);
      expect(
        await upsertTimetableSlots(tx, DEPT_CS, offering.termId, [
          {
            sectionOfferingId: so.id,
            resourceId: room.id,
            weekday: 2,
            startTime: "08:00",
            endTime: "09:00",
          },
        ]),
      ).toBe(1);
      expect(await slotsOfTerm(tx, offering.termId, { sectionOfferingId: so.id })).toHaveLength(1);
      expect(
        (await slotsOfTerm(tx, offering.termId, { resourceId: room.id })).map((x) => x.weekday),
      ).toEqual([2]);
      expect(await upsertTimetableSlots(tx, DEPT_CS, offering.termId, [], { replace: false })).toBe(
        0,
      );
    });
  });
});
