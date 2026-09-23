import { describe, expect, it } from "vitest";
import { instantOf, nextOccurrence, occurrences, partsIn } from "@/platform/workitem/recurrence";

const TZ = "Africa/Addis_Ababa"; // UTC+3, no DST
const BERLIN = "Europe/Berlin"; // DST, to prove the wall clock is kept

// 2026-09-21 09:00 local (06:00 UTC)
const start = new Date("2026-09-21T06:00:00Z");

function local(date: Date | null, tz = TZ): string {
  if (!date) return "none";
  const p = partsIn(date, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

describe("recurrence", () => {
  it("daily rules step by the interval and keep the wall-clock time", () => {
    const spec = {
      frequency: "daily" as const,
      interval: 1,
      byWeekday: [],
      startsOn: start,
      timezone: TZ,
    };
    expect(local(nextOccurrence(spec, start))).toBe("2026-09-22 09:00");
    expect(local(nextOccurrence({ ...spec, interval: 3 }, start))).toBe("2026-09-24 09:00");
    // before the start: the start itself is the next occurrence
    expect(local(nextOccurrence(spec, new Date("2026-01-01T00:00:00Z")))).toBe("2026-09-21 09:00");
  });

  it("weekly rules honour byWeekday and the interval", () => {
    const spec = {
      frequency: "weekly" as const,
      interval: 1,
      byWeekday: [1, 3], // Monday and Wednesday
      startsOn: start, // a Monday
      timezone: TZ,
    };
    expect(local(nextOccurrence(spec, start))).toBe("2026-09-23 09:00");
    expect(local(nextOccurrence(spec, new Date("2026-09-23T06:00:00Z")))).toBe("2026-09-28 09:00");
    const biweekly = { ...spec, interval: 2, byWeekday: [1] };
    expect(local(nextOccurrence(biweekly, start))).toBe("2026-10-05 09:00");
    // without byWeekday it simply steps whole weeks
    expect(local(nextOccurrence({ ...spec, byWeekday: [] }, start))).toBe("2026-09-28 09:00");
  });

  it("monthly rules clamp a day that a short month does not have", () => {
    const jan31 = new Date("2026-01-31T06:00:00Z");
    const spec = {
      frequency: "monthly" as const,
      interval: 1,
      byWeekday: [],
      byMonthDay: 31,
      startsOn: jan31,
      timezone: TZ,
    };
    expect(local(nextOccurrence(spec, jan31))).toBe("2026-02-28 09:00");
    expect(local(nextOccurrence(spec, new Date("2026-02-28T06:00:00Z")))).toBe("2026-03-31 09:00");
  });

  it("termly steps four months and yearly twelve", () => {
    const termly = {
      frequency: "termly" as const,
      interval: 1,
      byWeekday: [],
      startsOn: start,
      timezone: TZ,
    };
    expect(local(nextOccurrence(termly, start))).toBe("2027-01-21 09:00");
    const yearly = { ...termly, frequency: "yearly" as const };
    expect(local(nextOccurrence(yearly, start))).toBe("2027-09-21 09:00");
  });

  it("stops at endsOn and at count", () => {
    const spec = {
      frequency: "daily" as const,
      interval: 1,
      byWeekday: [],
      startsOn: start,
      endsOn: new Date("2026-09-23T06:00:00Z"),
      timezone: TZ,
    };
    expect(local(nextOccurrence(spec, start))).toBe("2026-09-22 09:00");
    expect(nextOccurrence(spec, new Date("2026-09-23T06:00:00Z"))).toBeNull();
    const counted = { ...spec, endsOn: null, count: 3 };
    expect(nextOccurrence(counted, start, 3)).toBeNull();
    expect(local(nextOccurrence(counted, start, 2))).toBe("2026-09-22 09:00");
    expect(occurrences({ ...spec, endsOn: null, count: 3 }, start, 5)).toHaveLength(3);
  });

  it("keeps the local time across a daylight-saving change", () => {
    // 2026-10-20 08:00 Berlin (summer time, UTC+2); the change is on 2026-10-25
    const berlinStart = instantOf({ year: 2026, month: 10, day: 20, hour: 8, minute: 0 }, BERLIN);
    const spec = {
      frequency: "weekly" as const,
      interval: 1,
      byWeekday: [],
      startsOn: berlinStart,
      timezone: BERLIN,
    };
    const next = nextOccurrence(spec, berlinStart);
    expect(local(next, BERLIN)).toBe("2026-10-27 08:00");
    // the UTC instant moved by an hour, the wall clock did not
    expect(next!.getTime() - berlinStart.getTime()).toBe(7 * 86_400_000 + 3_600_000);
  });
});
