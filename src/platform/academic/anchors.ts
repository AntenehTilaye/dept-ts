import type { PeriodKind } from "@/generated/prisma/enums";

// Calendar anchors (scheduler reminders, campaign windows, quarterly reports): pure functions
// over already-loaded periods and quarter boundaries so unit tests need no database.

export interface PeriodLike {
  kind: PeriodKind | string;
  startAt: Date;
  endAt: Date;
}

export interface AnchorSpec {
  periodKind: PeriodKind | string;
  edge: "start" | "end";
  offsetDays?: number;
}

export interface QuarterBoundary {
  q: number;
  startDate: string;
  endDate: string;
}

export class AnchorUnresolved extends Error {
  constructor(spec: AnchorSpec) {
    super(`No ${spec.periodKind} period to anchor on`);
    this.name = "AnchorUnresolved";
  }
}

const DAY_MS = 86_400_000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Resolves an anchor against a term's periods; the first period of the kind wins. */
export function resolveAnchor(spec: AnchorSpec, periods: PeriodLike[]): Date {
  const period = periods
    .filter((p) => p.kind === spec.periodKind)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
  if (!period) throw new AnchorUnresolved(spec);
  const base = spec.edge === "start" ? period.startAt : period.endAt;
  return addDays(base, spec.offsetDays ?? 0);
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The quarter (1..4) a date falls in, by the year's boundaries (inclusive, date precision). */
export function quarterOf(date: Date, boundaries: QuarterBoundary[]): number | null {
  const day = dateOnly(date);
  const hit = boundaries.find((b) => b.startDate <= day && day <= b.endDate);
  return hit ? hit.q : null;
}

/** Splits [start, end] into four contiguous quarters (the calendar admin's default proposal). */
export function defaultQuarters(startDate: Date, endDate: Date): QuarterBoundary[] {
  const total = Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1;
  const out: QuarterBoundary[] = [];
  let cursor = startDate;
  for (let q = 1; q <= 4; q++) {
    const len = q === 4 ? total - Math.floor(total / 4) * 3 : Math.floor(total / 4);
    const qEnd = addDays(cursor, len - 1);
    out.push({ q, startDate: dateOnly(cursor), endDate: dateOnly(q === 4 ? endDate : qEnd) });
    cursor = addDays(qEnd, 1);
  }
  return out;
}

export function validateQuarters(
  boundaries: QuarterBoundary[],
  startDate: Date,
  endDate: Date,
): string[] {
  const problems: string[] = [];
  if (boundaries.length !== 4) problems.push("exactly four quarters are required");
  const sorted = [...boundaries].sort((a, b) => a.q - b.q);
  sorted.forEach((b, i) => {
    if (b.q !== i + 1) problems.push(`quarter ${i + 1} is missing`);
    if (b.startDate > b.endDate) problems.push(`quarter ${b.q} ends before it starts`);
    if (i > 0 && sorted[i - 1]!.endDate >= b.startDate)
      problems.push(`quarter ${b.q} overlaps quarter ${b.q - 1}`);
  });
  if (sorted[0] && sorted[0].startDate !== dateOnly(startDate))
    problems.push("quarter 1 must start on the year start");
  if (sorted[3] && sorted[3].endDate !== dateOnly(endDate))
    problems.push("quarter 4 must end on the year end");
  return problems;
}
