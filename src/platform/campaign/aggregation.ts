import type { Aggregation, FieldDef } from "../forms/field-schema";

// Pure aggregation of answers. Every statistic is computed here and only here, so the
// k-anonymity rule ("a cell computed from fewer than k responses is withheld") is applied in
// one place: results below the threshold carry `suppressed: true` and no numbers at all.

export interface AnswerInput {
  submissionId: string;
  questionStableKey: string;
  groupIndex: number;
  value: unknown;
  numericValue?: number | null;
  rank?: number | null;
  /** Cohort attributes of the submission (for groupBy cells). */
  cohort?: Record<string, unknown> | null;
  subjectId?: string | null;
}

export type Stats =
  | {
      kind: "numeric";
      n: number;
      mean: number;
      sd: number;
      min: number;
      max: number;
      distribution: Record<string, number>;
    }
  | { kind: "choice"; n: number; counts: Record<string, number> }
  | {
      kind: "ranked";
      n: number;
      bordaByOption: Record<string, number>;
      firstChoice: Record<string, number>;
    }
  | { kind: "text"; n: number; samples: string[] }
  | { kind: "none"; n: number };

export interface Cell {
  questionStableKey: string;
  subjectId: string | null;
  groupByKey: string;
  groupBy: Record<string, unknown>;
  n: number;
  suppressed: boolean;
  stats: Stats | null;
}

export interface AggregateOptions {
  /** Responses below this count are withheld (SystemSetting campaign.kThreshold). */
  kThreshold: number;
  /** Cohort attribute names the results are broken down by. */
  groupBy?: string[];
  /** Free text is never returned for anonymous campaigns. */
  withholdText?: boolean;
  /** How many free-text samples to keep when text is allowed. */
  textSamples?: number;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function cellKey(groupBy: Record<string, unknown>): string {
  const keys = Object.keys(groupBy).sort();
  if (!keys.length) return "";
  return keys.map((k) => `${k}=${String(groupBy[k])}`).join("|");
}

function statsFor(
  field: FieldDef,
  rows: AnswerInput[],
  opts: AggregateOptions,
): { stats: Stats; n: number } {
  const respondents = new Set(rows.map((r) => r.submissionId));
  const n = respondents.size;
  const mode: Aggregation = field.aggregation ?? "none";

  if (field.type === "likert" || field.type === "scale" || field.type === "number") {
    const values = rows
      .map((r) => (typeof r.numericValue === "number" ? r.numericValue : Number(r.value)))
      .filter((v) => Number.isFinite(v));
    if (!values.length) return { stats: { kind: "none", n: 0 }, n: 0 };
    const distribution: Record<string, number> = {};
    for (const v of values) distribution[String(v)] = (distribution[String(v)] ?? 0) + 1;
    return {
      n,
      stats: {
        kind: "numeric",
        n: values.length,
        mean: round(mean(values)),
        sd: round(sd(values)),
        min: Math.min(...values),
        max: Math.max(...values),
        distribution,
      },
    };
  }

  if (field.type === "single_choice" || field.type === "multi_choice" || field.type === "boolean") {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const key = String(r.value);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return { n, stats: { kind: "choice", n, counts } };
  }

  if (field.type === "ranked_list") {
    // Borda: an option ranked first in a list of L options scores L, the next L-1, and so on.
    const perSubmission = new Map<string, AnswerInput[]>();
    for (const r of rows) {
      const list = perSubmission.get(r.submissionId) ?? [];
      list.push(r);
      perSubmission.set(r.submissionId, list);
    }
    const borda: Record<string, number> = {};
    const first: Record<string, number> = {};
    for (const list of perSubmission.values()) {
      const ordered = [...list].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      const length = ordered.length;
      ordered.forEach((row, index) => {
        const option = String(row.value);
        borda[option] = (borda[option] ?? 0) + (length - index);
        if (index === 0) first[option] = (first[option] ?? 0) + 1;
      });
    }
    return { n, stats: { kind: "ranked", n, bordaByOption: borda, firstChoice: first } };
  }

  if (field.type === "short_text" || field.type === "long_text") {
    if (opts.withholdText || mode === "none") return { n, stats: { kind: "text", n, samples: [] } };
    return {
      n,
      stats: {
        kind: "text",
        n,
        samples: rows.slice(0, opts.textSamples ?? 5).map((r) => String(r.value)),
      },
    };
  }

  return { n, stats: { kind: "none", n } };
}

/**
 * Aggregates the answers of one campaign into cells (question × subject × group-by), applying
 * the k-anonymity threshold per cell.
 */
export function aggregateAnswers(
  fields: FieldDef[],
  answers: AnswerInput[],
  opts: AggregateOptions,
): Cell[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const groupBy = opts.groupBy ?? [];
  const buckets = new Map<
    string,
    {
      field: FieldDef;
      subjectId: string | null;
      groupBy: Record<string, unknown>;
      rows: AnswerInput[];
    }
  >();

  for (const row of answers) {
    const field = byKey.get(row.questionStableKey);
    if (!field) continue;
    const cohort = row.cohort ?? {};
    const cell: Record<string, unknown> = {};
    for (const key of groupBy) cell[key] = cohort[key] ?? "unknown";
    const id = `${row.questionStableKey}::${row.subjectId ?? ""}::${cellKey(cell)}`;
    const bucket = buckets.get(id) ?? {
      field,
      subjectId: row.subjectId ?? null,
      groupBy: cell,
      rows: [],
    };
    bucket.rows.push(row);
    buckets.set(id, bucket);
  }

  const cells: Cell[] = [];
  for (const bucket of buckets.values()) {
    const { stats, n } = statsFor(bucket.field, bucket.rows, opts);
    const suppressed = n < opts.kThreshold;
    cells.push({
      questionStableKey: bucket.field.key,
      subjectId: bucket.subjectId,
      groupByKey: cellKey(bucket.groupBy),
      groupBy: bucket.groupBy,
      n,
      suppressed,
      stats: suppressed ? null : stats,
    });
  }
  return cells.sort(
    (a, b) =>
      a.questionStableKey.localeCompare(b.questionStableKey) ||
      (a.subjectId ?? "").localeCompare(b.subjectId ?? "") ||
      a.groupByKey.localeCompare(b.groupByKey),
  );
}

/** Response rate of a campaign. */
export function participationRate(invited: number, submitted: number): number {
  return invited === 0 ? 0 : round(submitted / invited, 4);
}
