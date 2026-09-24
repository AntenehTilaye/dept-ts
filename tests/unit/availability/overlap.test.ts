import { describe, expect, it } from "vitest";
import { weeklyOccurrences } from "@/platform/availability/blocks";
import { subtract, slice } from "@/platform/availability/free-slots";
import { overlaps } from "@/platform/availability/schema";

// The arithmetic every conflict check rests on, with no database in sight: does one interval
// touch another, which weeks does a weekly template actually land on, and what is left of a
// window once the busy time is cut out of it.

const at = (iso: string) => new Date(iso);
const interval = (from: string, to: string) => ({ from: at(from), to: at(to) });

describe("interval overlap", () => {
  it("touching intervals do not overlap, shared minutes do", () => {
    const morning = interval("2026-03-03T09:00:00Z", "2026-03-03T11:00:00Z");
    expect(overlaps(morning, interval("2026-03-03T11:00:00Z", "2026-03-03T12:00:00Z"))).toBe(false);
    expect(overlaps(morning, interval("2026-03-03T08:00:00Z", "2026-03-03T09:00:00Z"))).toBe(false);
    expect(overlaps(morning, interval("2026-03-03T10:30:00Z", "2026-03-03T12:00:00Z"))).toBe(true);
    // one inside the other, both ways round
    expect(overlaps(morning, interval("2026-03-03T09:30:00Z", "2026-03-03T10:00:00Z"))).toBe(true);
    expect(overlaps(interval("2026-03-03T08:00:00Z", "2026-03-03T13:00:00Z"), morning)).toBe(true);
  });
});

describe("weekly occurrences", () => {
  // 2026-03-03 is a Tuesday
  const template = {
    startAt: at("2026-03-03T09:00:00Z"),
    endAt: at("2026-03-03T11:00:00Z"),
    weekday: 2,
  };
  const march = interval("2026-03-01T00:00:00Z", "2026-03-31T23:59:00Z");

  it("lands on every matching weekday of the range", () => {
    const all = weeklyOccurrences(template, march, "all");
    expect(all.map((o) => o.from.toISOString().slice(0, 10))).toEqual([
      "2026-03-03",
      "2026-03-10",
      "2026-03-17",
      "2026-03-24",
      "2026-03-31",
    ]);
    // the duration of the template is kept
    expect(all[0]!.to.toISOString()).toBe("2026-03-03T11:00:00.000Z");
  });

  it("odd and even patterns take every other week, counting from the first occurrence", () => {
    const odd = weeklyOccurrences(template, march, "odd").map((o) =>
      o.from.toISOString().slice(0, 10),
    );
    const even = weeklyOccurrences(template, march, "even").map((o) =>
      o.from.toISOString().slice(0, 10),
    );
    expect(odd).toEqual(["2026-03-03", "2026-03-17", "2026-03-31"]);
    expect(even).toEqual(["2026-03-10", "2026-03-24"]);
    expect(odd.concat(even).sort()).toHaveLength(5);
  });

  it("a range with no matching weekday is empty", () => {
    const monday = interval("2026-03-02T00:00:00Z", "2026-03-02T23:00:00Z");
    expect(weeklyOccurrences(template, monday, "all")).toEqual([]);
  });
});

describe("subtracting busy time", () => {
  const window = [interval("2026-03-03T09:00:00Z", "2026-03-03T12:00:00Z")];

  it("splits a window around a block in the middle", () => {
    const left = subtract(window, [interval("2026-03-03T10:00:00Z", "2026-03-03T10:30:00Z")]);
    expect(left.map((i) => [i.from.toISOString(), i.to.toISOString()])).toEqual([
      ["2026-03-03T09:00:00.000Z", "2026-03-03T10:00:00.000Z"],
      ["2026-03-03T10:30:00.000Z", "2026-03-03T12:00:00.000Z"],
    ]);
  });

  it("trims at the edges, drops a fully covered window and ignores what does not touch", () => {
    expect(subtract(window, [interval("2026-03-03T08:00:00Z", "2026-03-03T09:30:00Z")])[0]!.from)
      .toEqual(at("2026-03-03T09:30:00Z"));
    expect(subtract(window, [interval("2026-03-03T08:00:00Z", "2026-03-03T13:00:00Z")])).toEqual([]);
    expect(subtract(window, [interval("2026-03-04T09:00:00Z", "2026-03-04T10:00:00Z")])).toHaveLength(
      1,
    );
  });
});

describe("slicing", () => {
  it("cuts a window into slots and leaves a remainder shorter than one slot unused", () => {
    const slots = slice([interval("2026-03-03T09:00:00Z", "2026-03-03T10:10:00Z")], 30);
    expect(slots.map((s) => s.from.toISOString().slice(11, 16))).toEqual(["09:00", "09:30"]);
    // the last ten minutes are not a slot anybody can book
    expect(slots[1]!.to.toISOString().slice(11, 16)).toBe("10:00");
  });

  it("without a slot length each opening stays one slot", () => {
    const open = [interval("2026-03-03T09:00:00Z", "2026-03-03T12:00:00Z")];
    expect(slice(open, null)).toEqual(open);
  });
});
