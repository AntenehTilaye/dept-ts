import { describe, expect, it } from "vitest";
import {
  AnchorUnresolved,
  defaultQuarters,
  quarterOf,
  resolveAnchor,
  validateQuarters,
} from "@/platform/academic/anchors";

const periods = [
  {
    kind: "add_drop",
    startAt: new Date("2026-09-14T08:00:00Z"),
    endAt: new Date("2026-09-28T17:00:00Z"),
  },
  {
    kind: "examination",
    startAt: new Date("2027-01-11T08:00:00Z"),
    endAt: new Date("2027-01-29T17:00:00Z"),
  },
  {
    kind: "custom",
    startAt: new Date("2026-10-01T08:00:00Z"),
    endAt: new Date("2026-10-02T17:00:00Z"),
  },
  {
    kind: "custom",
    startAt: new Date("2026-09-07T08:00:00Z"),
    endAt: new Date("2026-09-11T17:00:00Z"),
  },
];

describe("resolveAnchor", () => {
  it("resolves start and end edges with offsets in days", () => {
    expect(resolveAnchor({ periodKind: "add_drop", edge: "start" }, periods)).toEqual(
      new Date("2026-09-14T08:00:00Z"),
    );
    expect(resolveAnchor({ periodKind: "add_drop", edge: "end", offsetDays: -3 }, periods)).toEqual(
      new Date("2026-09-25T17:00:00Z"),
    );
    expect(
      resolveAnchor({ periodKind: "examination", edge: "start", offsetDays: 7 }, periods),
    ).toEqual(new Date("2027-01-18T08:00:00Z"));
  });

  it("uses the earliest period of a kind", () => {
    expect(resolveAnchor({ periodKind: "custom", edge: "start" }, periods)).toEqual(
      new Date("2026-09-07T08:00:00Z"),
    );
  });

  it("raises AnchorUnresolved for a missing kind", () => {
    expect(() => resolveAnchor({ periodKind: "evaluation", edge: "end" }, periods)).toThrow(
      AnchorUnresolved,
    );
  });
});

describe("quarters", () => {
  const start = new Date("2026-09-14T00:00:00Z");
  const end = new Date("2027-07-14T00:00:00Z");
  const quarters = defaultQuarters(start, end);

  it("proposes four contiguous quarters covering the year", () => {
    expect(quarters.map((q) => q.q)).toEqual([1, 2, 3, 4]);
    expect(quarters[0]!.startDate).toBe("2026-09-14");
    expect(quarters[3]!.endDate).toBe("2027-07-14");
    for (let i = 1; i < 4; i++) {
      const prevEnd = new Date(quarters[i - 1]!.endDate + "T00:00:00Z");
      expect(new Date(quarters[i]!.startDate + "T00:00:00Z").getTime() - prevEnd.getTime()).toBe(
        86_400_000,
      );
    }
    expect(validateQuarters(quarters, start, end)).toEqual([]);
  });

  it("finds the quarter of a date including boundary days", () => {
    expect(quarterOf(new Date("2026-09-14T23:00:00Z"), quarters)).toBe(1);
    expect(quarterOf(new Date(quarters[1]!.startDate + "T00:00:00Z"), quarters)).toBe(2);
    expect(quarterOf(new Date(quarters[2]!.endDate + "T12:00:00Z"), quarters)).toBe(3);
    expect(quarterOf(new Date("2027-07-14T00:00:00Z"), quarters)).toBe(4);
    expect(quarterOf(new Date("2027-08-01T00:00:00Z"), quarters)).toBeNull();
  });

  it("rejects overlapping, missing or misaligned quarters", () => {
    const bad = quarters.map((q) => ({ ...q }));
    bad[1]!.startDate = bad[0]!.endDate;
    expect(validateQuarters(bad, start, end)).toContain("quarter 2 overlaps quarter 1");
    expect(validateQuarters(quarters.slice(0, 3), start, end)).toContain(
      "exactly four quarters are required",
    );
    expect(validateQuarters(quarters, new Date("2026-09-01T00:00:00Z"), end)).toContain(
      "quarter 1 must start on the year start",
    );
  });
});
