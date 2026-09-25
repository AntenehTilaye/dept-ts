import { createHash } from "node:crypto";
import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { record as audit } from "../audit/record";
import { storeGenerated } from "../document";
import { can } from "../identity/can";
import { dbPolicyStore } from "../identity/policy-store";
import type { Actor } from "../identity/can";
import { enqueue } from "../scheduler/enqueue";
import { renderHtml } from "./html";
import { requireReport, type ReportFormat } from "./registry";
import { renderCsv, renderXlsx } from "./sheets";

// Asking for a report and getting one. HTML and CSV are small and synchronous; a PDF needs a
// browser and a workbook can be large, so those are a job — and either way the answer is a
// `GeneratedReport` row that the page can poll and a stored Document to download.

export class ReportForbiddenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ReportForbiddenError";
  }
}

export interface GenerateResult {
  id: string;
  status: "done" | "queued";
  /** Present when the format was rendered synchronously. */
  html?: string;
  documentId?: string | null;
}

export async function generate(
  tx: Db,
  actor: Actor,
  reportKey: string,
  format: ReportFormat,
  params: Record<string, unknown> = {},
): Promise<GenerateResult> {
  const definition = requireReport(reportKey);
  if (!definition.formats.includes(format))
    throw new ReportForbiddenError(`"${definition.title}" is not available as ${format}`);

  const decision = await can(dbPolicyStore, actor, definition.requiredPermission, undefined, {
    verb: "read",
  });
  if (!decision.allowed) throw new ReportForbiddenError(decision.reason);

  const parsed = definition.parameters ? definition.parameters.parse(params) : params;
  const run = await tx.generatedReport.create({
    data: {
      departmentId: actor.departmentId,
      reportKey,
      paramsJson: toJson(parsed as Record<string, unknown>),
      format,
      requestedBy: actor.userId,
      status: "queued",
    },
  });

  // a page can wait for these, so it gets them straight away
  if (format === "html" || format === "csv") {
    const data = await definition.dataSource({
      db: tx,
      actor,
      departmentId: actor.departmentId,
      params: parsed as Record<string, unknown>,
    });
    const output = format === "html" ? renderHtml(data) : renderCsv(data);
    // every format ends as a file somebody can keep, the readable one included
    const document = await store(
      tx,
      actor,
      run.id,
      definition.title,
      Buffer.from(output, "utf8"),
      format,
    );
    await tx.generatedReport.update({
      where: { id: run.id },
      data: { status: "done", generatedAt: new Date(), documentId: document.id },
    });
    await audit(tx, {
      action: "create",
      subjectType: "generated_report",
      subjectId: run.id,
      departmentId: actor.departmentId,
      actorUserId: actor.userId,
      reason: `${reportKey} as ${format}`,
    });
    return {
      id: run.id,
      status: "done",
      ...(format === "html" ? { html: output } : {}),
      documentId: document.id,
    };
  }

  await enqueue(
    tx,
    "report.generate",
    { generatedReportId: run.id, departmentId: actor.departmentId },
    {
      kind: "report_generate",
      departmentId: actor.departmentId,
      subjectType: "generated_report",
      subjectId: run.id,
      // the same report, parameters and format asked for twice is one job
      singletonKey: `report:${reportKey}:${hash(parsed)}:${format}`,
      idempotencyKey: `report:${run.id}`,
    },
  );
  return { id: run.id, status: "queued" };
}

/**
 * Renders a queued run and stores the output. This is what the worker calls; it is here rather
 * than in the handler so the whole path can be tested without a queue.
 */
export async function runGeneration(tx: Db, generatedReportId: string): Promise<string | null> {
  const run = await tx.generatedReport.findUniqueOrThrow({ where: { id: generatedReportId } });
  const definition = requireReport(run.reportKey);
  await tx.generatedReport.update({
    where: { id: run.id },
    data: { status: "running" },
  });

  const actor: Actor = {
    userId: run.requestedBy,
    personId: null,
    departmentId: run.departmentId,
    isAdmin: true,
  };
  const data = await definition.dataSource({
    db: tx,
    actor,
    departmentId: run.departmentId,
    params: (run.paramsJson ?? {}) as Record<string, unknown>,
  });

  const bytes =
    run.format === "xlsx"
      ? await renderXlsx(data)
      : run.format === "pdf"
        ? await renderPdf(renderHtml(data))
        : Buffer.from(renderCsv(data), "utf8");

  const document = await store(tx, actor, run.id, definition.title, bytes, run.format);
  await tx.generatedReport.update({
    where: { id: run.id },
    data: { status: "done", generatedAt: new Date(), documentId: document.id, error: null },
  });
  return document.id;
}

/** The PDF renderer lives in the worker (it owns the browser); the web process never calls it. */
let pdfRenderer: ((html: string) => Promise<Buffer>) | null = null;

export function setPdfRenderer(renderer: ((html: string) => Promise<Buffer>) | null): void {
  pdfRenderer = renderer;
}

async function renderPdf(html: string): Promise<Buffer> {
  if (!pdfRenderer)
    throw new Error("No PDF renderer is installed; a report in pdf is rendered by the worker");
  return pdfRenderer(html);
}

const EXTENSION: Record<string, { ext: string; mime: string }> = {
  pdf: { ext: "pdf", mime: "application/pdf" },
  xlsx: {
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  csv: { ext: "csv", mime: "text/csv" },
  html: { ext: "html", mime: "text/html" },
};

async function store(
  tx: Db,
  actor: Actor,
  runId: string,
  title: string,
  bytes: Buffer,
  format: string,
) {
  const { ext, mime } = EXTENSION[format] ?? EXTENSION.csv!;
  const stamp = new Date().toISOString().slice(0, 10);
  const { document } = await storeGenerated(
    tx,
    actor.departmentId,
    actor.userId,
    bytes,
    {
      title: `${title} ${stamp}`,
      originalName: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}.${ext}`,
      mimeType: mime,
    },
    [
      {
        subjectType: "generated_report",
        subjectId: runId,
        linkRole: "generated_output",
        slotKey: "output",
      },
    ],
  );
  return document;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? {})).digest("hex").slice(0, 16);
}
