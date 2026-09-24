import { atLocalTime, isoWeekday, minutesOfDay, partsIn } from "../../lib/time";
import type { Db } from "../../lib/db/types";
import { blocksFor, occurrencesOf } from "./blocks";
import { policyFor, type ResolvedPolicy } from "./policies";
import { overlaps, type Interval, type PolicyPurpose } from "./schema";

// When is somebody actually bookable? Their windows, minus their breaks, minus everything the
// ledger already holds for them, cut into slots. The arithmetic is pure so it can be read and
// tested without a database; `freeSlots` is the thin query around it.

/** The windows of a policy inside a range, as concrete intervals in the department's timezone. */
export function windowIntervals(policy: ResolvedPolicy, range: Interval): Interval[] {
  const out: Interval[] = [];
  const day = new Date(range.from);
  day.setUTCHours(0, 0, 0, 0);

  while (day <= range.to) {
    const weekday = isoWeekday(day, policy.timezone);
    for (const window of policy.weeklyWindows) {
      if (window.weekday !== weekday) continue;
      const from = atLocalTime(day, window.from, policy.timezone);
      const to = atLocalTime(day, window.to, policy.timezone);
      const clipped = { from: max(from, range.from), to: min(to, range.to) };
      if (clipped.to > clipped.from) out.push(clipped);
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out.sort((a, b) => a.from.getTime() - b.from.getTime());
}

/** The breaks of a policy inside a range, as concrete intervals. */
export function breakIntervals(policy: ResolvedPolicy, range: Interval): Interval[] {
  const out: Interval[] = [];
  const day = new Date(range.from);
  day.setUTCHours(0, 0, 0, 0);

  while (day <= range.to) {
    const weekday = isoWeekday(day, policy.timezone);
    for (const brk of policy.breakWindows) {
      if (brk.weekday != null && brk.weekday !== weekday) continue;
      out.push({
        from: atLocalTime(day, brk.from, policy.timezone),
        to: atLocalTime(day, brk.to, policy.timezone),
      });
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}

/** Cuts `busy` out of `open` and returns what is left, in order. */
export function subtract(open: Interval[], busy: Interval[]): Interval[] {
  let out = open.map((i) => ({ ...i }));
  for (const b of busy) {
    const next: Interval[] = [];
    for (const o of out) {
      if (!overlaps(o, b)) {
        next.push(o);
        continue;
      }
      if (b.from > o.from) next.push({ from: o.from, to: b.from });
      if (b.to < o.to) next.push({ from: b.to, to: o.to });
    }
    out = next;
  }
  return out.filter((i) => i.to > i.from).sort((a, b) => a.from.getTime() - b.from.getTime());
}

/** Cuts open time into slots of `slotMinutes`; without a slot length each opening is one slot. */
export function slice(open: Interval[], slotMinutes: number | null): Interval[] {
  if (!slotMinutes) return open;
  const out: Interval[] = [];
  for (const interval of open) {
    let from = new Date(interval.from);
    while (from.getTime() + slotMinutes * 60_000 <= interval.to.getTime()) {
      const to = new Date(from.getTime() + slotMinutes * 60_000);
      out.push({ from, to });
      from = to;
    }
  }
  return out;
}

/** The pure core: the free slots a policy leaves once the busy intervals are removed. */
export function openSlots(
  policy: ResolvedPolicy,
  busy: Interval[],
  range: Interval,
): Interval[] {
  const windows = windowIntervals(policy, range);
  if (!windows.length) return [];
  const blocked = [
    ...breakIntervals(policy, range),
    ...policy.blackoutPeriods.map((b) => ({ from: b.fromAt, to: b.toAt })),
    ...busy,
  ];
  return slice(subtract(windows, blocked), policy.slotMinutes);
}

/** Whether an interval falls entirely inside the policy's windows and outside its breaks. */
export function windowsCover(policy: ResolvedPolicy, interval: Interval, _tz?: string): boolean {
  const open = subtract(windowIntervals(policy, interval), breakIntervals(policy, interval));
  return open.some((o) => o.from <= interval.from && o.to >= interval.to);
}

/** What somebody has free for a purpose in a range — the policy's windows minus the ledger. */
export async function freeSlots(
  tx: Db,
  departmentId: string,
  ownerPersonId: string,
  range: Interval,
  purpose: PolicyPurpose,
  now: Date = new Date(),
): Promise<Interval[]> {
  const policy = await policyFor(tx, departmentId, ownerPersonId, purpose, now);
  if (!policy) return [];
  const blocks = await blocksFor(
    tx,
    departmentId,
    { ownerType: "person", ownerId: ownerPersonId },
    range,
  );
  const busy = blocks.flatMap((block) => occurrencesOf(block, range));
  return openSlots(policy, busy, range);
}

/** A readable label for a slot in the department's timezone: "Tue 09:00–09:30". */
export function slotLabel(interval: Interval, timezone: string): string {
  const p = partsIn(interval.from, timezone);
  const q = partsIn(interval.to, timezone);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday];
  const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${day} ${hhmm(p.hour, p.minute)}–${hhmm(q.hour, q.minute)}`;
}

export { minutesOfDay };

function min(a: Date, b: Date): Date {
  return a < b ? a : b;
}
function max(a: Date, b: Date): Date {
  return a > b ? a : b;
}
