import { describe, expect, it } from "vitest";
import {
  aggregateAnswers,
  participationRate,
  type AnswerInput,
} from "@/platform/campaign/aggregation";
import type { FieldDef } from "@/platform/forms/field-schema";

const fields: FieldDef[] = [
  { key: "clarity", type: "likert", label: "Clarity", aggregation: "mean", sourceBinding: "none" },
  {
    key: "mode",
    type: "single_choice",
    label: "Mode",
    aggregation: "count",
    sourceBinding: "none",
    options: [
      { value: "online", label: "Online" },
      { value: "onsite", label: "Onsite" },
    ],
  },
  {
    key: "prefs",
    type: "ranked_list",
    label: "Preferences",
    aggregation: "rank_sum",
    sourceBinding: "none",
  },
  {
    key: "comment",
    type: "long_text",
    label: "Comment",
    aggregation: "none",
    sourceBinding: "none",
  },
];

function likert(
  submissionId: string,
  value: number,
  cohort?: Record<string, unknown>,
): AnswerInput {
  return {
    submissionId,
    questionStableKey: "clarity",
    groupIndex: 0,
    value,
    numericValue: value,
    cohort,
  };
}

describe("aggregateAnswers", () => {
  it("computes mean, sd, range and distribution for likert answers", () => {
    const rows = [
      likert("s1", 5),
      likert("s2", 4),
      likert("s3", 5),
      likert("s4", 2),
      likert("s5", 4),
    ];
    const [cell] = aggregateAnswers(fields, rows, { kThreshold: 5 });
    expect(cell).toMatchObject({ questionStableKey: "clarity", n: 5, suppressed: false });
    expect(cell!.stats).toMatchObject({
      kind: "numeric",
      mean: 4,
      min: 2,
      max: 5,
      distribution: { "2": 1, "4": 2, "5": 2 },
    });
    expect((cell!.stats as { sd: number }).sd).toBeCloseTo(1.225, 3);
  });

  it("counts choices and computes Borda plus first-choice for ranked lists", () => {
    const rows: AnswerInput[] = [
      { submissionId: "s1", questionStableKey: "mode", groupIndex: 0, value: "online" },
      { submissionId: "s2", questionStableKey: "mode", groupIndex: 0, value: "online" },
      { submissionId: "s3", questionStableKey: "mode", groupIndex: 0, value: "onsite" },
      { submissionId: "s1", questionStableKey: "prefs", groupIndex: 0, value: "A", rank: 1 },
      { submissionId: "s1", questionStableKey: "prefs", groupIndex: 1, value: "B", rank: 2 },
      { submissionId: "s1", questionStableKey: "prefs", groupIndex: 2, value: "C", rank: 3 },
      { submissionId: "s2", questionStableKey: "prefs", groupIndex: 0, value: "B", rank: 1 },
      { submissionId: "s2", questionStableKey: "prefs", groupIndex: 1, value: "A", rank: 2 },
    ];
    const cells = aggregateAnswers(fields, rows, { kThreshold: 1 });
    const mode = cells.find((c) => c.questionStableKey === "mode")!;
    expect(mode.stats).toMatchObject({ kind: "choice", counts: { online: 2, onsite: 1 } });
    const prefs = cells.find((c) => c.questionStableKey === "prefs")!;
    expect(prefs.stats).toMatchObject({
      kind: "ranked",
      bordaByOption: { A: 4, B: 4, C: 1 },
      firstChoice: { A: 1, B: 1 },
    });
  });

  it("breaks results down by cohort attributes", () => {
    const rows = [
      likert("s1", 5, { year: 2 }),
      likert("s2", 3, { year: 2 }),
      likert("s3", 1, { year: 3 }),
    ];
    const cells = aggregateAnswers(fields, rows, { kThreshold: 1, groupBy: ["year"] });
    expect(cells.map((c) => c.groupByKey).sort()).toEqual(["year=2", "year=3"]);
    const y2 = cells.find((c) => c.groupByKey === "year=2")!;
    expect(y2).toMatchObject({ n: 2 });
    expect(y2.stats).toMatchObject({ mean: 4 });
  });

  it("suppresses a cell below the threshold and withholds free text", () => {
    const rows = [likert("s1", 5), likert("s2", 4)];
    const [cell] = aggregateAnswers(fields, rows, { kThreshold: 5 });
    expect(cell).toMatchObject({ n: 2, suppressed: true, stats: null });

    const text: AnswerInput[] = [
      { submissionId: "s1", questionStableKey: "comment", groupIndex: 0, value: "great" },
      { submissionId: "s2", questionStableKey: "comment", groupIndex: 0, value: "too fast" },
    ];
    const countedText = { ...fields[3]!, aggregation: "count" as const };
    const withheld = aggregateAnswers([countedText], text, { kThreshold: 1, withholdText: true });
    expect(withheld[0]!.stats).toMatchObject({ kind: "text", samples: [] });
    const shown = aggregateAnswers([countedText], text, { kThreshold: 1 });
    expect((shown[0]!.stats as { samples: string[] }).samples).toEqual(["great", "too fast"]);
  });

  it("reports the participation rate", () => {
    expect(participationRate(0, 0)).toBe(0);
    expect(participationRate(8, 2)).toBe(0.25);
  });
});
