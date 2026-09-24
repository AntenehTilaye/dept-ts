import { describe, expect, it } from "vitest";
import { openSlots, slotLabel, windowsCover } from "@/platform/availability/free-slots";
import type { ResolvedPolicy } from "@/platform/availability/policies";

// What somebody has free, worked out from their policy alone. The times a policy declares are
// wall-clock times in the department's zone — Addis Ababa is UTC+3 all year — so 09:00 local is
// 06:00Z, and every expectation here is written in UTC to make that visible.

const TZ = "Africa/Addis_Ababa";

function policy(over: Partial<ResolvedPolicy> = {}): ResolvedPolicy {
  return {
    id: "pol_1",
    ownerPersonId: "per_1",
    purpose: "appointments",
    // Tuesday and Thursday mornings
    weeklyWindows: [
      { weekday: 2, from: "09:00", to: "12:00" },
      { weekday: 4, from: "09:00", to: "12:00" },
    ],
    breakWindows: [],
    blackoutPeriods: [],
    slotMinutes: 30,
    maxPerPeriod: null,
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validTo: null,
    timezone: TZ,
    ...over,
  };
}

// 2026-03-03 is a Tuesday, 2026-03-05 a Thursday
const week = { from: new Date("2026-03-02T00:00:00Z"), to: new Date("2026-03-08T00:00:00Z") };
const times = (slots: { from: Date; to: Date }[]) =>
  slots.map((s) => s.from.toISOString().slice(0, 16));

describe("free slots", () => {
  it("cuts the declared windows into slots, in the department's timezone", () => {
    const slots = openSlots(policy(), [], week);
    expect(slots).toHaveLength(12); // two mornings of three hours, half-hourly
    expect(times(slots)[0]).toBe("2026-03-03T06:00"); // 09:00 in Addis Ababa
    expect(times(slots).at(-1)).toBe("2026-03-05T08:30");
    expect(slotLabel(slots[0]!, TZ)).toBe("Tue 09:00–09:30");
  });

  it("keeps the breaks, the days away and the ledger out", () => {
    const withBreak = policy({ breakWindows: [{ from: "10:00", to: "10:30" }] });
    expect(times(openSlots(withBreak, [], week))).not.toContain("2026-03-03T07:00");

    const away = policy({
      blackoutPeriods: [
        { fromAt: new Date("2026-03-05T00:00:00Z"), toAt: new Date("2026-03-06T00:00:00Z") },
      ],
    });
    expect(times(openSlots(away, [], week)).every((t) => t.startsWith("2026-03-03"))).toBe(true);

    const busy = [
      { from: new Date("2026-03-03T06:00:00Z"), to: new Date("2026-03-03T07:00:00Z") },
    ];
    expect(times(openSlots(policy(), busy, week))[0]).toBe("2026-03-03T07:00");
  });

  it("a whole window is one slot when the policy declares no slot length", () => {
    const slots = openSlots(policy({ slotMinutes: null }), [], week);
    expect(slots).toHaveLength(2);
    expect(slots[0]!.to.toISOString().slice(11, 16)).toBe("09:00"); // 12:00 local
  });

  it("no windows means nothing is free", () => {
    expect(openSlots(policy({ weeklyWindows: [] }), [], week)).toEqual([]);
  });

  it("windowsCover answers whether a booking fits inside the declared time", () => {
    const inside = {
      from: new Date("2026-03-03T06:30:00Z"),
      to: new Date("2026-03-03T07:00:00Z"),
    };
    const straddling = {
      from: new Date("2026-03-03T08:30:00Z"),
      to: new Date("2026-03-03T09:30:00Z"),
    };
    expect(windowsCover(policy(), inside)).toBe(true);
    expect(windowsCover(policy(), straddling)).toBe(false);
    // a break splits the window, so a booking across it is not covered either
    expect(windowsCover(policy({ breakWindows: [{ from: "10:00", to: "10:30" }] }), {
      from: new Date("2026-03-03T06:45:00Z"),
      to: new Date("2026-03-03T07:15:00Z"),
    })).toBe(false);
  });
});
