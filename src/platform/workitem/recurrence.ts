import { z } from "zod";
import { instantOf, partsIn, type Parts } from "../../lib/time";

// Recurrence arithmetic for repeating tasks. Pure and timezone-aware: occurrences land on the
// same wall-clock time in the rule's timezone (Africa/Addis_Ababa by default), so a daily task
// stays at 09:00 local across DST-free and DST-observing zones alike. The wall-clock
// conversions themselves live in src/lib/time.ts, which the availability ledger shares.

export { instantOf, partsIn } from "../../lib/time";

export const Frequency = z.enum(["daily", "weekly", "monthly", "termly", "yearly"]);
export type Frequency = z.infer<typeof Frequency>;

export const RecurrenceSpec = z.object({
  frequency: Frequency,
  interval: z.number().int().min(1).default(1),
  /** 0 = Sunday … 6 = Saturday; weekly rules only. */
  byWeekday: z.array(z.number().int().min(0).max(6)).default([]),
  /** Day of month (1–31); monthly rules only. A short month clamps to its last day. */
  byMonthDay: z.number().int().min(1).max(31).nullish(),
  startsOn: z.coerce.date(),
  endsOn: z.coerce.date().nullish(),
  /** Maximum number of occurrences ever spawned. */
  count: z.number().int().min(1).nullish(),
  timezone: z.string().default("Africa/Addis_Ababa"),
});
export type RecurrenceSpec = z.infer<typeof RecurrenceSpec>;

/** Months a termly rule steps by. */
const TERMLY_MONTHS = 4;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(p: Parts, days: number): Parts {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return {
    ...p,
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
}

function addMonths(p: Parts, months: number): Parts {
  const total = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  const d = new Date(Date.UTC(year, month - 1, day));
  return { ...p, year, month, day, weekday: d.getUTCDay() };
}

/**
 * The first occurrence strictly after `after` (or the start itself when `after` is before it).
 * Returns null once the rule has ended (`endsOn`) or run out of occurrences (`count`).
 */
export function nextOccurrence(spec: RecurrenceSpec, after: Date, spawnedCount = 0): Date | null {
  const rule = RecurrenceSpec.parse(spec);
  if (rule.count !== null && rule.count !== undefined && spawnedCount >= rule.count) return null;
  const tz = rule.timezone;
  const start = partsIn(rule.startsOn, tz);
  const limit = rule.endsOn ? rule.endsOn.getTime() : Infinity;
  if (rule.startsOn.getTime() > after.getTime()) {
    return rule.startsOn.getTime() <= limit ? rule.startsOn : null;
  }

  const emit = (p: Parts): Date =>
    instantOf({ ...p, hour: start.hour, minute: start.minute, second: start.second }, tz);

  if (rule.frequency === "weekly" && rule.byWeekday.length) {
    const wanted = [...new Set(rule.byWeekday)].sort((a, b) => a - b);
    // walk week blocks of `interval` weeks from the start week
    let cursor = addDays(start, -start.weekday); // Sunday of the start week
    for (let guard = 0; guard < 520; guard++) {
      for (const wd of wanted) {
        const day = addDays(cursor, wd);
        const at = emit(day);
        if (at.getTime() > after.getTime() && at.getTime() >= rule.startsOn.getTime()) {
          return at.getTime() <= limit ? at : null;
        }
      }
      cursor = addDays(cursor, 7 * rule.interval);
    }
    return null;
  }

  let cursor = start;
  for (let guard = 0; guard < 2000; guard++) {
    switch (rule.frequency) {
      case "daily":
        cursor = addDays(cursor, rule.interval);
        break;
      case "weekly":
        cursor = addDays(cursor, 7 * rule.interval);
        break;
      case "monthly":
        cursor = addMonths(
          rule.byMonthDay ? { ...cursor, day: rule.byMonthDay } : cursor,
          rule.interval,
        );
        break;
      case "termly":
        cursor = addMonths(cursor, TERMLY_MONTHS * rule.interval);
        break;
      case "yearly":
        cursor = addMonths(cursor, 12 * rule.interval);
        break;
    }
    const at = emit(cursor);
    if (at.getTime() > after.getTime()) return at.getTime() <= limit ? at : null;
  }
  return null;
}

/** The next `n` occurrences after `after` (for previews). */
export function occurrences(spec: RecurrenceSpec, after: Date, n: number): Date[] {
  const out: Date[] = [];
  let cursor = after;
  for (let i = 0; i < n; i++) {
    const next = nextOccurrence(spec, cursor, i);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}
