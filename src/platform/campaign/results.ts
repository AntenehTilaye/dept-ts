import Papa from "papaparse";
import { fromJson, toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { publish as emit } from "../audit/outbox";
import { storeGenerated } from "../document/service";
import { fieldsOf } from "../forms/definitions";
import { aggregateAnswers, participationRate, type AnswerInput, type Cell } from "./aggregation";
import { participation } from "./service";

// Reading the results: aggregation into AggregationResult rows (k-anonymity applied by
// ./aggregation) and the CSV export, stored as a Document so it inherits the same access rules
// as every other file.

export const DEFAULT_K_THRESHOLD = 5;

export async function kThreshold(db: Db): Promise<number> {
  const row = await db.systemSetting.findFirst({
    where: { key: "campaign.kThreshold", scope: "global" },
  });
  return typeof row?.valueJson === "number" ? row.valueJson : DEFAULT_K_THRESHOLD;
}

/** Recomputes every cell of a campaign and replaces its stored results. */
export async function aggregateCampaign(db: Db, campaignId: string, now: Date = new Date()) {
  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { form: { include: { questions: { orderBy: { order: "asc" } } } } },
  });
  const fields = fieldsOf(campaign.form);
  const submissions = await db.submission.findMany({
    where: { campaignId, status: "submitted" },
    include: { answers: true },
  });
  const spec = campaign.aggregationSpecJson
    ? fromJson<{ groupBy?: string[]; textSamples?: number }>(campaign.aggregationSpecJson)
    : {};
  const rows: AnswerInput[] = [];
  for (const s of submissions) {
    const cohort = s.cohortAttributesJson
      ? fromJson<Record<string, unknown>>(s.cohortAttributesJson)
      : null;
    for (const a of s.answers) {
      rows.push({
        submissionId: s.id,
        questionStableKey: a.questionStableKey,
        groupIndex: a.groupIndex,
        value: a.valueJson,
        numericValue: a.numericValue === null ? null : Number(a.numericValue),
        rank: a.rank,
        cohort,
        subjectId: s.campaignSubjectId,
      });
    }
  }
  const cells = aggregateAnswers(fields, rows, {
    kThreshold: await kThreshold(db),
    groupBy: spec.groupBy,
    // free text is never released for an anonymous campaign
    withholdText: campaign.anonymityMode === "anonymous",
    textSamples: spec.textSamples,
  });

  await db.aggregationResult.deleteMany({ where: { campaignId } });
  for (const cell of cells) {
    await db.aggregationResult.create({
      data: {
        departmentId: campaign.departmentId,
        campaignId,
        subjectId: cell.subjectId,
        questionStableKey: cell.questionStableKey,
        groupByKey: cell.groupByKey,
        groupByJson: toJson(cell.groupBy),
        n: cell.n,
        statsJson: toJson(cell.stats ?? {}),
        suppressed: cell.suppressed,
        computedAt: now,
      },
    });
  }
  await db.campaign.update({ where: { id: campaignId }, data: { aggregatedAt: now } });
  await emit(
    db,
    "campaign.aggregated",
    { subjectType: "campaign", subjectId: campaignId },
    { campaignId, cells: cells.length },
    { departmentId: campaign.departmentId },
  );
  return cells;
}

export interface ResultsView {
  campaign: { id: string; title: string; anonymityMode: string; minResponsesForReport: number };
  participation: Awaited<ReturnType<typeof participation>> & { rate: number };
  belowReportThreshold: boolean;
  cells: Array<Cell & { questionLabel: string; subjectLabel: string | null }>;
}

/** Everything the results page shows, with labels resolved. */
export async function results(db: Db, campaignId: string): Promise<ResultsView> {
  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: {
      form: { include: { questions: { orderBy: { order: "asc" } } } },
      subjects: true,
      results: true,
    },
  });
  const labels = new Map(campaign.form.questions.map((q) => [q.stableKey, q.label]));
  const subjectLabels = new Map(campaign.subjects.map((s) => [s.id, s.label]));
  const stats = await participation(db, campaignId);
  return {
    campaign: {
      id: campaign.id,
      title: campaign.title,
      anonymityMode: campaign.anonymityMode,
      minResponsesForReport: campaign.minResponsesForReport,
    },
    participation: { ...stats, rate: participationRate(stats.invited, stats.submitted) },
    belowReportThreshold: stats.responses < campaign.minResponsesForReport,
    cells: campaign.results
      .map((r) => ({
        questionStableKey: r.questionStableKey,
        questionLabel: labels.get(r.questionStableKey) ?? r.questionStableKey,
        subjectId: r.subjectId,
        subjectLabel: r.subjectId ? (subjectLabels.get(r.subjectId) ?? null) : null,
        groupByKey: r.groupByKey,
        groupBy: fromJson<Record<string, unknown>>(r.groupByJson),
        n: r.n,
        suppressed: r.suppressed,
        stats: r.suppressed ? null : (fromJson<Cell["stats"]>(r.statsJson) ?? null),
      }))
      .sort(
        (a, b) =>
          (a.subjectLabel ?? "").localeCompare(b.subjectLabel ?? "") ||
          a.questionLabel.localeCompare(b.questionLabel) ||
          a.groupByKey.localeCompare(b.groupByKey),
      ),
  };
}

function statsCell(stats: Cell["stats"]): string {
  if (!stats) return "suppressed";
  switch (stats.kind) {
    case "numeric":
      return `mean ${stats.mean} (sd ${stats.sd}, n ${stats.n})`;
    case "choice":
      return Object.entries(stats.counts)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
    case "ranked":
      return Object.entries(stats.bordaByOption)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
    case "text":
      return stats.samples.join(" | ");
    default:
      return "";
  }
}

/** CSV of the aggregated results, stored as a Document (never the raw responses). */
export async function exportResults(
  db: Db,
  departmentId: string,
  campaignId: string,
  createdBy: string,
) {
  const view = await results(db, campaignId);
  const csv = Papa.unparse(
    view.cells.map((c) => ({
      subject: c.subjectLabel ?? "",
      question: c.questionLabel,
      group: c.groupByKey,
      responses: c.n,
      suppressed: c.suppressed ? "yes" : "no",
      result: statsCell(c.stats),
    })),
  );
  const title = `${view.campaign.title} results`;
  return storeGenerated(
    db,
    departmentId,
    createdBy,
    Buffer.from(`${csv}\n`, "utf8"),
    {
      title,
      originalName: `campaign-${campaignId}-results.csv`,
      mimeType: "text/csv",
      category: "campaign_results",
    },
    [{ subjectType: "campaign", subjectId: campaignId, linkRole: "generated_output" }],
  );
}
