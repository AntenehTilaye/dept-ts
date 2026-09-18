import type { PrismaClient } from "../../src/generated/prisma/client";
import {
  createAcademicYear,
  createTerm,
  setCurrentTerm,
  setPeriod,
} from "../../src/platform/academic/calendar";
import { SEED_DEPARTMENTS } from "./departments";

// Academic calendar per department: the previous closed year (CQI baseline), the current year
// with two terms, and one period of every PeriodKind in the current term. Dates are fixed so
// e2e specs and demo data stay stable; "today" is 2026-09-18 in the design's timeline.
export const SEED_YEARS = {
  previous: { code: "2025/26", start: "2025-09-15", end: "2026-07-15" },
  current: { code: "2026/27", start: "2026-09-14", end: "2027-07-14" },
} as const;

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const at = (iso: string, hour = 8) =>
  new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00.000Z`);

export async function seedCalendar(db: PrismaClient) {
  for (const dept of SEED_DEPARTMENTS) {
    const departmentId = dept.id;
    for (const [key, y] of Object.entries(SEED_YEARS)) {
      let year = await db.academicYear.findUnique({
        where: { departmentId_code: { departmentId, code: y.code } },
      });
      if (!year) {
        year = await createAcademicYear(db, departmentId, {
          code: y.code,
          startDate: d(y.start),
          endDate: d(y.end),
        });
      }
      const startYear = Number(y.start.slice(0, 4));
      const terms = [
        {
          ordinal: "first" as const,
          name: "Semester I",
          start: y.start,
          end: `${startYear + 1}-01-31`,
        },
        {
          ordinal: "second" as const,
          name: "Semester II",
          start: `${startYear + 1}-02-16`,
          end: y.end,
        },
      ];
      for (const t of terms) {
        let term = await db.term.findUnique({
          where: { academicYearId_ordinal: { academicYearId: year.id, ordinal: t.ordinal } },
        });
        if (!term) {
          term = await createTerm(db, departmentId, {
            academicYearId: year.id,
            ordinal: t.ordinal,
            name: t.name,
            startDate: d(t.start),
            endDate: d(t.end),
          });
        }
        if (key === "previous")
          await db.term.update({ where: { id: term.id }, data: { status: "closed" } });
        if (key === "current" && t.ordinal === "first") {
          if (term.status !== "current") await setCurrentTerm(db, departmentId, term.id);
          await seedPeriods(db, departmentId, term.id, y.start);
        }
      }
      if (key === "previous")
        await db.academicYear.update({ where: { id: year.id }, data: { status: "closed" } });
    }
  }
}

async function seedPeriods(
  db: PrismaClient,
  departmentId: string,
  termId: string,
  termStart: string,
) {
  const y = Number(termStart.slice(0, 4));
  const periods = [
    {
      kind: "registration" as const,
      label: "Registration",
      start: `${y}-09-07`,
      end: `${y}-09-13`,
    },
    { kind: "add_drop" as const, label: "Add/Drop", start: `${y}-09-14`, end: `${y}-09-28` },
    {
      kind: "course_preference" as const,
      label: "Course preferences",
      start: `${y}-08-24`,
      end: `${y}-09-06`,
    },
    {
      kind: "elective_selection" as const,
      label: "Elective selection",
      start: `${y}-09-14`,
      end: `${y}-09-25`,
    },
    {
      kind: "teaching" as const,
      label: "Teaching weeks",
      start: `${y}-09-14`,
      end: `${y + 1}-01-08`,
    },
    {
      kind: "examination" as const,
      label: "Final examinations",
      start: `${y + 1}-01-11`,
      end: `${y + 1}-01-29`,
    },
    {
      kind: "portfolio_submission" as const,
      label: "Portfolio submission",
      start: `${y + 1}-01-18`,
      end: `${y + 1}-02-05`,
    },
    {
      kind: "evaluation" as const,
      label: "Staff evaluation",
      start: `${y}-12-07`,
      end: `${y}-12-23`,
    },
    { kind: "custom" as const, label: "Orientation week", start: `${y}-09-07`, end: `${y}-09-11` },
  ];
  for (const p of periods) {
    const existing = await db.calendarPeriod.findFirst({
      where: { termId, kind: p.kind, label: p.label },
    });
    if (existing) continue;
    await setPeriod(db, departmentId, {
      termId,
      kind: p.kind,
      label: p.label,
      startAt: at(p.start),
      endAt: at(p.end, 17),
    });
  }
}
