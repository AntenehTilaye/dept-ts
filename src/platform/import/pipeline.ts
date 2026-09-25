import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { publish } from "../audit/outbox";
import { record as audit } from "../audit/record";
import type { Actor } from "../identity/can";
import { commitRows } from "./committers/registry";
import { applyMapping, resolveMapping, type MappingProfileInput } from "./mapping";
import { parseFile, type ParsedSheet } from "./parse";
import { kindSpec } from "./templates";
import { validateRows, type RowVerdict } from "./validators/registry";

// The staged pipeline: read, map, validate, look at it, fix what is wrong, commit. Each stage
// leaves what it produced in the database, so a batch can be looked at, corrected and finished
// later — and the workflow of the `import_batch` feature is what moves it from stage to stage.

export interface BatchSummary {
  rows: number;
  errors: number;
  warnings: number;
  truncated?: number;
  headers?: string[];
  mappings?: Record<string, string>;
  unmapped?: string[];
  missingRequired?: string[];
  committed?: Record<string, number>;
  message?: string;
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_state" | "unmapped" | "has_errors" | "not_found" = "invalid_state",
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export interface ParseInput {
  bytes: Buffer;
  nameOrType: string;
  sheetName?: string | null;
  headerRowIndex?: number;
  maxRows?: number;
}

export interface CreateBatchInput {
  kind: string;
  /** What the rows are about: the section, the term, the offering. */
  context?: { subjectType: string; subjectId: string } | null;
  file?: { bytes: Buffer; originalName: string; mimeType: string };
  /** A grid somebody typed instead of a file they were sent. */
  manualRows?: { headers: string[]; rows: Record<string, unknown>[] };
  mappingProfileId?: string | null;
  note?: string;
}

/**
 * Starts an import: the record whose lifecycle this is, the ImportBatch its backing adapter
 * creates, the file stored as a document linked under the `source` slot, and — for a file small
 * enough to read at once — the rows already in place. What is left is somebody's judgement.
 */
export async function createBatch(
  tx: Db,
  departmentId: string,
  actor: Actor,
  input: CreateBatchInput,
): Promise<{ recordId: string; batchId: string; summary: BatchSummary }> {
  const { createRecord } = await import("../feature/runtime/create");
  const fileName = input.file?.originalName ?? "Typed rows";
  const record = await createRecord(tx, departmentId, actor, "import_batch", {
    presetKey: input.kind,
    parentRef: input.context ?? null,
    data: { kind: input.kind, file_name: fileName, ...(input.note ? { note: input.note } : {}) },
  });
  const batch = await tx.importBatch.findFirstOrThrow({ where: { featureRecordId: record.id } });
  if (input.mappingProfileId)
    await tx.importBatch.update({
      where: { id: batch.id },
      data: { mappingProfileId: input.mappingProfileId },
    });

  if (input.file) {
    const { upload } = await import("../document");
    const { document } = await upload(
      tx,
      actor,
      input.file.bytes,
      {
        title: fileName,
        originalName: fileName,
        mimeType: input.file.mimeType,
      },
      [
        {
          subjectType: "feature_record",
          subjectId: record.id,
          linkRole: "source",
          slotKey: "source",
        },
      ],
    );
    await tx.importBatch.update({
      where: { id: batch.id },
      data: { sourceDocumentId: document.id },
    });
    const summary = await parseBatch(tx, batch.id, {
      bytes: input.file.bytes,
      nameOrType: input.file.originalName || input.file.mimeType,
    });
    return { recordId: record.id, batchId: batch.id, summary };
  }

  if (input.manualRows) {
    await tx.importBatch.update({ where: { id: batch.id }, data: { mode: "manual" } });
    const summary = await storeManualRows(
      tx,
      batch.id,
      input.manualRows.headers,
      input.manualRows.rows,
    );
    return { recordId: record.id, batchId: batch.id, summary };
  }

  return { recordId: record.id, batchId: batch.id, summary: await summaryFor(tx, batch.id) };
}

/** Reads the file into rows and stores them as they arrived. Nothing is interpreted yet. */
export async function parseBatch(
  tx: Db,
  batchId: string,
  input: ParseInput,
): Promise<BatchSummary> {
  const batch = await batchOf(tx, batchId);
  const profile = await profileOf(tx, batch.mappingProfileId);
  const sheet = await parseFile(input.bytes, input.nameOrType, {
    sheetName: input.sheetName ?? profile?.sheetName ?? null,
    headerRowIndex: input.headerRowIndex ?? profile?.headerRowIndex ?? 1,
    maxRows: input.maxRows,
  });
  return storeRows(tx, batch, sheet, profile);
}

/** The same, for a grid somebody typed instead of a file they were sent. */
export async function storeManualRows(
  tx: Db,
  batchId: string,
  headers: string[],
  rows: Record<string, unknown>[],
): Promise<BatchSummary> {
  const batch = await batchOf(tx, batchId);
  const profile = await profileOf(tx, batch.mappingProfileId);
  return storeRows(tx, batch, { headers, rows, truncated: 0 }, profile);
}

async function storeRows(
  tx: Db,
  batch: { id: string; departmentId: string; kind: string },
  sheet: ParsedSheet,
  profile: MappingProfileInput | null,
): Promise<BatchSummary> {
  const spec = kindSpec(batch.kind);
  const mapping = resolveMapping(sheet.headers, spec.columns, profile ?? undefined);

  await tx.importRow.deleteMany({ where: { batchId: batch.id } });
  for (const [index, row] of sheet.rows.entries()) {
    await tx.importRow.create({
      data: {
        departmentId: batch.departmentId,
        batchId: batch.id,
        rowNo: index + 1,
        rawJson: toJson(row),
      },
    });
  }

  const summary: BatchSummary = {
    rows: sheet.rows.length,
    errors: 0,
    warnings: 0,
    truncated: sheet.truncated,
    headers: sheet.headers,
    mappings: mapping.mappings,
    unmapped: mapping.unmapped,
    missingRequired: mapping.missingRequired,
  };
  await saveSummary(tx, batch.id, summary);
  return summary;
}

/** Runs the kind's validator over the stored rows and writes what it found onto each one. */
export async function validateBatch(tx: Db, batchId: string): Promise<BatchSummary> {
  const batch = await batchOf(tx, batchId);
  const summary = summaryOf(batch);
  if (summary.missingRequired?.length)
    throw new ImportError(
      `The file has no column for: ${summary.missingRequired.join(", ")}`,
      "unmapped",
    );

  const rows = await tx.importRow.findMany({
    where: { batchId },
    orderBy: { rowNo: "asc" },
  });
  const mapped = applyMapping(
    rows.map((r) => (r.rawJson ?? {}) as Record<string, unknown>),
    summary.mappings ?? {},
  );
  const verdicts = await validateRows(batch.kind, {
    tx,
    departmentId: batch.departmentId,
    context: contextOf(batch),
  }, mapped);

  let errors = 0;
  let warnings = 0;
  for (const [index, row] of rows.entries()) {
    const verdict: RowVerdict = verdicts[index] ?? { errors: [], warnings: [] };
    errors += verdict.errors.length ? 1 : 0;
    warnings += verdict.warnings.length ? 1 : 0;
    await tx.importRow.update({
      where: { id: row.id },
      data: {
        normalizedJson: verdict.normalized ? toJson(verdict.normalized) : undefined,
        errorsJson: toJson(verdict.errors),
        warningsJson: toJson(verdict.warnings),
        disposition: verdict.errors.length ? "error" : "ok",
      },
    });
  }

  const next = { ...summary, rows: rows.length, errors, warnings };
  await saveSummary(tx, batchId, next);
  return next;
}

/** One page of the batch as it will be committed, with what is wrong beside each row. */
export async function preview(
  tx: Db,
  batchId: string,
  opts: { page?: number; pageSize?: number; only?: "error" | "warning" } = {},
) {
  const pageSize = opts.pageSize ?? 50;
  const page = Math.max(1, opts.page ?? 1);
  const where = {
    batchId,
    ...(opts.only === "error" ? { disposition: "error" as const } : {}),
  };
  const [rows, total] = await Promise.all([
    tx.importRow.findMany({
      where,
      orderBy: { rowNo: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    tx.importRow.count({ where }),
  ]);
  const filtered =
    opts.only === "warning"
      ? rows.filter((r) => Array.isArray(r.warningsJson) && r.warningsJson.length)
      : rows;
  return { rows: filtered, total, page, pageSize };
}

/** Corrects one row and validates the batch again, so the counts stay true. */
export async function fixRow(
  tx: Db,
  batchId: string,
  rowNo: number,
  patch: Record<string, unknown>,
): Promise<BatchSummary> {
  const row = await tx.importRow.findUnique({ where: { batchId_rowNo: { batchId, rowNo } } });
  if (!row) throw new ImportError(`This batch has no row ${rowNo}`, "not_found");
  const batch = await batchOf(tx, batchId);
  const summary = summaryOf(batch);
  const headers = summary.mappings ?? {};

  // the patch is written in the committer's field names; the row keeps the file's headers
  const raw = { ...((row.rawJson ?? {}) as Record<string, unknown>) };
  for (const [field, value] of Object.entries(patch)) {
    const header = headers[field] ?? field;
    raw[header] = value;
  }
  await tx.importRow.update({ where: { id: row.id }, data: { rawJson: toJson(raw) } });
  return validateBatch(tx, batchId);
}

/**
 * Writes the batch. Refused while any row is in error, so "commit" always means the whole file:
 * the committer runs inside the caller's transaction, the previous batch of the same context is
 * marked replaced, and `import.committed` is published for whoever cares.
 */
export async function commitBatch(
  tx: Db,
  actor: Actor,
  batchId: string,
): Promise<BatchSummary> {
  const batch = await batchOf(tx, batchId);
  if (batch.committedAt) throw new ImportError("This batch has already been committed");
  const errors = await tx.importRow.count({ where: { batchId, disposition: "error" } });
  if (errors)
    throw new ImportError(
      `${errors} row(s) still have errors; fix or remove them before committing`,
      "has_errors",
    );

  const rows = await tx.importRow.findMany({
    where: { batchId, disposition: { not: "skip" } },
    orderBy: { rowNo: "asc" },
  });
  const summary = await commitRows(
    batch.kind,
    {
      tx,
      actor,
      departmentId: batch.departmentId,
      batchId,
      context: contextOf(batch),
    },
    rows.map((r) => (r.normalizedJson ?? r.rawJson ?? {}) as Record<string, unknown>),
  );

  const previous = batch.contextType
    ? await tx.importBatch.findFirst({
        where: {
          kind: batch.kind as never,
          contextType: batch.contextType as never,
          contextId: batch.contextId,
          committedAt: { not: null },
          id: { not: batchId },
          replacedBy: { none: {} },
        },
        orderBy: { committedAt: "desc" },
      })
    : null;

  await tx.importBatch.update({
    where: { id: batchId },
    data: {
      committedAt: new Date(),
      replacesBatchId: previous?.id ?? null,
      summaryJson: toJson({ ...summaryOf(batch), committed: summary.counts, message: summary.message }),
    },
  });

  await audit(tx, {
    action: "update",
    subjectType: "import_batch",
    subjectId: batchId,
    departmentId: batch.departmentId,
    actorUserId: actor.userId ?? null,
    reason: summary.message,
  });
  await publish(
    tx,
    "import.committed",
    { subjectType: "import_batch", subjectId: batchId },
    {
      kind: batch.kind,
      contextType: batch.contextType,
      contextId: batch.contextId,
      counts: summary.counts,
    },
    { departmentId: batch.departmentId },
  );

  return { ...summaryOf(batch), committed: summary.counts, message: summary.message };
}

/** Marks a row as one the commit should skip, without deleting what arrived. */
export async function skipRow(tx: Db, batchId: string, rowNo: number): Promise<void> {
  await tx.importRow.update({
    where: { batchId_rowNo: { batchId, rowNo } },
    data: { disposition: "skip", errorsJson: toJson([]) },
  });
}

export async function summaryFor(tx: Db, batchId: string): Promise<BatchSummary> {
  return summaryOf(await batchOf(tx, batchId));
}

async function batchOf(tx: Db, batchId: string) {
  const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new ImportError(`No import batch ${batchId}`, "not_found");
  return batch;
}

async function profileOf(tx: Db, profileId: string | null) {
  if (!profileId) return null;
  const profile = await tx.columnMappingProfile.findUnique({ where: { id: profileId } });
  if (!profile) return null;
  return {
    mappings: (profile.mappingsJson ?? {}) as Record<string, string>,
    headerAliases: (profile.headerAliasesJson ?? {}) as Record<string, string[]>,
    sheetName: profile.sheetName,
    headerRowIndex: profile.headerRowIndex,
  };
}

function summaryOf(batch: { summaryJson: unknown }): BatchSummary {
  const summary = (batch.summaryJson ?? {}) as Partial<BatchSummary>;
  return { rows: summary.rows ?? 0, errors: summary.errors ?? 0, warnings: summary.warnings ?? 0, ...summary };
}

function contextOf(batch: { contextType: string | null; contextId: string | null }) {
  return batch.contextType && batch.contextId
    ? { subjectType: batch.contextType, subjectId: batch.contextId }
    : null;
}

async function saveSummary(tx: Db, batchId: string, summary: BatchSummary): Promise<void> {
  await tx.importBatch.update({ where: { id: batchId }, data: { summaryJson: toJson(summary) } });
}
