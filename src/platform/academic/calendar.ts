import type { PeriodKind, TermOrdinal } from "@/generated/prisma/enums";
import { fromJson, toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import {
  defaultQuarters,
  quarterOf,
  resolveAnchor,
  validateQuarters,
  type AnchorSpec,
  type QuarterBoundary,
} from "./anchors";

// Academic calendar: years with quarter boundaries, terms, typed periods. Period edits return
// the dependents list for the admin impact preview (scheduler subscriptions plug in later).

export interface AcademicYearInput {
  code: string;
  startDate: Date;
  endDate: Date;
  quarters?: QuarterBoundary[];
}

export async function createAcademicYear(db: Db, departmentId: string, input: AcademicYearInput) {
  if (input.endDate <= input.startDate) throw new Error("The year must end after it starts");
  const quarters = input.quarters ?? defaultQuarters(input.startDate, input.endDate);
  const problems = validateQuarters(quarters, input.startDate, input.endDate);
  if (problems.length) throw new Error(problems.join("; "));
  return db.academicYear.create({
    data: {
      departmentId,
      code: input.code.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      quarterBoundariesJson: toJson(quarters),
    },
  });
}

export async function setYearStatus(
  db: Db,
  yearId: string,
  status: "planned" | "active" | "closed",
) {
  if (status === "active") {
    const year = await db.academicYear.findUniqueOrThrow({ where: { id: yearId } });
    await db.academicYear.updateMany({
      where: { departmentId: year.departmentId, status: "active", NOT: { id: yearId } },
      data: { status: "closed" },
    });
  }
  return db.academicYear.update({ where: { id: yearId }, data: { status } });
}

export async function listYears(db: Db, departmentId: string) {
  return db.academicYear.findMany({
    where: { departmentId },
    include: {
      terms: {
        include: { periods: { orderBy: { startAt: "asc" } } },
        orderBy: { startDate: "asc" },
      },
    },
    orderBy: { startDate: "desc" },
  });
}

export interface TermInput {
  academicYearId: string;
  ordinal: TermOrdinal;
  name: string;
  startDate: Date;
  endDate: Date;
}

export async function createTerm(db: Db, departmentId: string, input: TermInput) {
  const year = await db.academicYear.findUniqueOrThrow({ where: { id: input.academicYearId } });
  if (input.startDate < year.startDate || input.endDate > year.endDate)
    throw new Error("The term must lie inside its academic year");
  if (input.endDate <= input.startDate) throw new Error("The term must end after it starts");
  return db.term.create({
    data: {
      departmentId,
      academicYearId: input.academicYearId,
      ordinal: input.ordinal,
      name: input.name.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
    },
  });
}

/** Marks a term current (only one current term per department) and activates its year. */
export async function setCurrentTerm(db: Db, departmentId: string, termId: string) {
  const term = await db.term.findUniqueOrThrow({ where: { id: termId } });
  await db.term.updateMany({
    where: { departmentId, status: "current", NOT: { id: termId } },
    data: { status: "closed" },
  });
  await setYearStatus(db, term.academicYearId, "active");
  return db.term.update({ where: { id: termId }, data: { status: "current" } });
}

export async function currentTerm(db: Db, departmentId: string) {
  return db.term.findFirst({
    where: { departmentId, status: "current" },
    include: { academicYear: true, periods: { orderBy: { startAt: "asc" } } },
  });
}

export interface PeriodInput {
  id?: string;
  termId: string;
  kind: PeriodKind;
  label: string;
  startAt: Date;
  endAt: Date;
}

export interface Dependent {
  kind: string;
  id: string;
  label: string;
}

/** Hook point for the scheduler's impact preview; returns rows that anchor on a period. */
let dependentsResolver: (db: Db, periodId: string) => Promise<Dependent[]> = async () => [];

export function setPeriodDependentsResolver(fn: typeof dependentsResolver): void {
  dependentsResolver = fn;
}

/** Creates or moves a period; returns the period and the rows that depend on it. */
export async function setPeriod(db: Db, departmentId: string, input: PeriodInput) {
  if (input.endAt <= input.startAt) throw new Error("The period must end after it starts");
  // Registration and preference windows precede the term, so the bound is the academic year.
  const term = await db.term.findUniqueOrThrow({
    where: { id: input.termId },
    include: { academicYear: true },
  });
  const dayStart = new Date(term.academicYear.startDate.getTime() - 60 * 86_400_000);
  const dayEnd = new Date(term.academicYear.endDate.getTime() + 86_400_000);
  if (input.startAt < dayStart || input.endAt > dayEnd)
    throw new Error(
      "The period must lie inside its academic year (up to 60 days before it starts)",
    );
  const data = {
    kind: input.kind,
    label: input.label.trim(),
    startAt: input.startAt,
    endAt: input.endAt,
  };
  const period = input.id
    ? await db.calendarPeriod.update({ where: { id: input.id }, data })
    : await db.calendarPeriod.create({ data: { departmentId, termId: input.termId, ...data } });
  const dependents = await dependentsResolver(db, period.id);
  return { period, dependents };
}

export async function previewPeriodImpact(db: Db, periodId: string): Promise<Dependent[]> {
  return dependentsResolver(db, periodId);
}

export async function deletePeriod(db: Db, periodId: string) {
  await db.calendarPeriod.delete({ where: { id: periodId } });
}

/** Resolves an anchor against a term's periods (loads them). */
export async function resolveTermAnchor(db: Db, termId: string, spec: AnchorSpec): Promise<Date> {
  const periods = await db.calendarPeriod.findMany({ where: { termId } });
  return resolveAnchor(spec, periods);
}

/** The quarter of a date in the year (loads boundaries). */
export async function quarterOfDate(
  db: Db,
  academicYearId: string,
  date: Date,
): Promise<number | null> {
  const year = await db.academicYear.findUniqueOrThrow({ where: { id: academicYearId } });
  return quarterOf(date, fromJson<QuarterBoundary[]>(year.quarterBoundariesJson));
}
