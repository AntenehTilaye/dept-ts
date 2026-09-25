import type { Readable } from "node:stream";
import { globalSingleton } from "@/lib/singleton";
import { storage } from "@/lib/storage";
import {
  commitBatch,
  fixRow,
  ImportError,
  parseBatch,
  storeManualRows,
  validateBatch,
} from "@/platform/import";
import { enqueue } from "@/platform/scheduler/enqueue";
import { registerFeatureEffect, registerFeatureGuard, registerStepAdapter } from "../register";

// What the `import_batch` feature's states actually do. The pipeline does the work; these are
// the named hooks the definition points at, which is what keeps the definition free of logic
// and lets a later phase add a kind without touching the process.

const state = globalSingleton("module-imports", () => ({ installed: false }));

/** Files under this are read inside the request; bigger ones go to the worker. */
const INLINE_LIMIT_BYTES = 1_000_000;

export function registerImportAdapters(): void {
  if (state.installed) return;
  state.installed = true;

  registerStepAdapter(
    {
      key: "import_batch.backing",
      module: "imports",
      hook: "backing",
      description: "Creates the ImportBatch the record stands for.",
    },
    async (ctx) => {
      if (!ctx.record) return;
      const data = ctx.record.data ?? {};
      const kind = String(data.kind ?? ctx.record.presetKey ?? "roster");
      const record = await ctx.tx.featureRecord.findUniqueOrThrow({
        where: { id: ctx.record.id },
        select: {
          parentSubjectType: true,
          parentSubjectId: true,
          createdByPersonId: true,
          ownerPersonId: true,
        },
      });
      const owner = await ctx.tx.person.findUnique({
        where: { id: record.createdByPersonId },
        select: { userId: true },
      });
      const batch = await ctx.tx.importBatch.create({
        data: {
          departmentId: ctx.departmentId,
          kind: kind as never,
          contextType: record.parentSubjectType,
          contextId: record.parentSubjectId,
          mode: "file",
          featureRecordId: ctx.record.id,
          uploadedBy: owner?.userId ?? "system",
        },
      });
      // the id goes back into the record's own data, so every later step finds it
      return { import_batch_id: batch.id };
    },
  );

  registerFeatureEffect(
    {
      key: "import.parse",
      module: "imports",
      description: "Reads the uploaded file (or the typed grid) into rows.",
    },
    async (ctx) => {
      const batch = await batchOfInstance(ctx);
      const document = await ctx.tx.documentLink.findFirst({
        where: {
          subjectType: "feature_record",
          subjectId: ctx.instance.subjectId,
          slotKey: "source",
        },
        orderBy: { createdAt: "desc" },
      });
      const version = document
        ? await ctx.tx.documentVersion.findFirst({
            where: { documentId: document.documentId },
            orderBy: { versionNo: "desc" },
          })
        : null;
      if (!version) {
        // a grid somebody typed has no file: its rows were stored when they saved it
        await validateManualOrFail(ctx, batch.id);
        return;
      }
      await ctx.tx.importBatch.update({
        where: { id: batch.id },
        data: { sourceDocumentId: version.documentId },
      });
      const record = await recordData(ctx);
      const sheetName = (record.sheet_name as string | null) ?? null;
      const headerRowIndex = Number(record.header_row) || 1;
      const nameOrType = version.originalName ?? version.mimeType ?? "";

      // a workbook is decompressed in memory: past a size worth waiting for, the worker reads it
      // and checks it, and the page shows the rows when the job lands
      if (version.sizeBytes > INLINE_LIMIT_BYTES) {
        await enqueue(
          ctx.tx,
          "import.parse",
          {
            batchId: batch.id,
            departmentId: ctx.instance.departmentId,
            storageKey: version.storageKey,
            nameOrType,
            sheetName,
            headerRowIndex,
            validate: true,
          },
          {
            kind: "import_parse",
            departmentId: ctx.instance.departmentId,
            subjectType: "import_batch",
            subjectId: batch.id,
            idempotencyKey: `import-parse:${batch.id}:${version.id}`,
          },
        );
        return;
      }

      const bytes = await readAll(await storage().get(version.storageKey));
      await parseBatch(ctx.tx, batch.id, { bytes, nameOrType, sheetName, headerRowIndex });
    },
  );

  registerFeatureEffect(
    {
      key: "import.validate",
      module: "imports",
      description: "Runs the kind's validator over the rows and records what is wrong.",
    },
    async (ctx) => {
      const batch = await batchOfInstance(ctx);
      await validateBatch(ctx.tx, batch.id);
    },
  );

  registerFeatureEffect(
    {
      key: "import.commit",
      module: "imports",
      description: "Writes the batch through the kind's committer, in this transaction.",
    },
    async (ctx) => {
      const batch = await batchOfInstance(ctx);
      const actor = ctx.actor ?? {
        userId: "system",
        personId: null,
        departmentId: ctx.instance.departmentId,
        isAdmin: true,
      };
      await commitBatch(ctx.tx, actor, batch.id);
    },
  );

  registerFeatureGuard(
    {
      key: "import.noRowsInError",
      module: "imports",
      description: "A batch may only be committed once every row is understood.",
    },
    async (ctx) => {
      const batch = await ctx.tx.importBatch.findFirst({
        where: { featureRecordId: ctx.instance.subjectId },
        select: { id: true },
      });
      if (!batch) return { ok: false as const, reason: "This import has no batch" };
      const errors = await ctx.tx.importRow.count({
        where: { batchId: batch.id, disposition: "error" },
      });
      const rows = await ctx.tx.importRow.count({ where: { batchId: batch.id } });
      if (!rows) return { ok: false as const, reason: "There is nothing to commit yet" };
      return errors ? { ok: false as const, reason: `${errors} row(s) still have errors` } : true;
    },
  );

  registerFeatureGuard(
    {
      key: "import.actorMayCommit",
      module: "imports",
      description: "Only somebody who may manage imports writes them into the department.",
    },
    async (ctx) => {
      if (!ctx.actor) return { ok: false as const, reason: "Only a person may commit an import" };
      if (ctx.actor.isAdmin) return true;
      const { can } = await import("@/platform/identity/can");
      const { dbPolicyStore } = await import("@/platform/identity/policy-store");
      const decision = await can(dbPolicyStore, ctx.actor, "import.manage", undefined, {
        verb: "approve",
      });
      return decision.allowed ? true : { ok: false as const, reason: decision.reason };
    },
  );

  registerFeatureGuard(
    {
      key: "import.sectionNotLocked",
      module: "imports",
      description: "Refuses a commit into a section whose results are already locked.",
    },
    async (ctx) => {
      const batch = await ctx.tx.importBatch.findFirst({
        where: { featureRecordId: ctx.instance.subjectId },
      });
      if (batch?.contextType !== "section_offering" || !batch.contextId) return true;
      const offering = await ctx.tx.sectionOffering.findUnique({
        where: { id: batch.contextId },
        select: { assessmentLockedAt: true },
      });
      return offering?.assessmentLockedAt
        ? { ok: false as const, reason: "This section's assessment is locked; unlock it before importing" }
        : true;
    },
  );
}

/** Fixing a row from the preview surface, as a step adapter so the surface stays declarative. */
export async function applyRowFix(
  ctx: { tx: Parameters<typeof fixRow>[0] },
  batchId: string,
  rowNo: number,
  patch: Record<string, unknown>,
) {
  return fixRow(ctx.tx, batchId, rowNo, patch);
}

/** The document service hands out a stream; the parsers want the whole sheet. */
async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

async function batchOfInstance(ctx: {
  tx: Parameters<typeof validateBatch>[0];
  instance: { subjectId: string };
}) {
  const batch = await ctx.tx.importBatch.findFirst({
    where: { featureRecordId: ctx.instance.subjectId },
  });
  if (!batch) throw new ImportError("This import has no batch", "not_found");
  return batch;
}

async function recordData(ctx: {
  tx: Parameters<typeof validateBatch>[0];
  instance: { subjectId: string };
}): Promise<Record<string, unknown>> {
  const record = await ctx.tx.featureRecord.findUnique({
    where: { id: ctx.instance.subjectId },
    select: { data: true },
  });
  return ((record?.data ?? {}) as Record<string, unknown>) ?? {};
}

/** A manual grid is parsed when it is saved; reading it again is a no-op with a clear error. */
async function validateManualOrFail(
  ctx: { tx: Parameters<typeof storeManualRows>[0]; instance: { subjectId: string } },
  batchId: string,
): Promise<void> {
  const rows = await ctx.tx.importRow.count({ where: { batchId } });
  if (!rows)
    throw new ImportError(
      "Upload the spreadsheet first, or type the rows into the grid and save them",
      "not_found",
    );
}
