import { describe, expect, it } from "vitest";
import { mergeActivity, type ActivityRow } from "@/modules/committees/queries";

// The merge is the whole of the committee's history: four kernels each keep their own rows, and
// what a reader wants is one list in the order things happened.

const at = (iso: string) => new Date(iso);

const transitions: ActivityRow[] = [
  { kind: "transition", at: at("2026-01-10T09:00:00Z"), label: "setup → active" },
  { kind: "transition", at: at("2026-03-02T10:00:00Z"), label: "active → inactive" },
];
const reports: ActivityRow[] = [
  { kind: "report", at: at("2026-02-01T08:00:00Z"), label: "Report for January", by: "A. Chair" },
];
const comments: ActivityRow[] = [
  { kind: "comment", at: at("2026-01-15T12:00:00Z"), label: "Comment", detail: "Noted." },
];
const documents: ActivityRow[] = [
  { kind: "document", at: at("2026-01-09T16:00:00Z"), label: "Terms of reference" },
];

describe("a committee's activity", () => {
  it("puts the newest thing first, whichever kernel recorded it", () => {
    const rows = mergeActivity([transitions, reports, comments, documents]);
    expect(rows.map((r) => r.kind)).toEqual([
      "transition",
      "report",
      "comment",
      "transition",
      "document",
    ]);
    expect(rows[0]!.label).toBe("active → inactive");
    expect(rows.at(-1)!.label).toBe("Terms of reference");
  });

  it("keeps every row's kind, so a reader can tell a report from a comment", () => {
    const rows = mergeActivity([reports, comments]);
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(["report", "comment"]));
    expect(rows.find((r) => r.kind === "report")?.by).toBe("A. Chair");
  });

  it("drops a row with no time rather than claiming it happened last", () => {
    const rows = mergeActivity([
      reports,
      [{ kind: "task", at: new Date("not a date"), label: "A task with no date" }],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("report");
  });

  it("has nothing to show for a committee that has done nothing", () => {
    expect(mergeActivity([[], [], [], []])).toEqual([]);
  });
});
