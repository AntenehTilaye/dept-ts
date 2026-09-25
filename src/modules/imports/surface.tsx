import { kindSpec, preview } from "@/platform/import";
import type { RecordExtras, SurfaceContext } from "../surfaces";
import { MappingEditor, type MappingField } from "./components/MappingEditor";
import { PreviewTable, type PreviewRow } from "./components/PreviewTable";
import { StatCard } from "@/components/patterns/StatCard";

// What an import shows beyond the generic record page: the counts, which column is which, and
// every row with its problems. The generic page renders the process; this renders the file.

export async function importRecordExtras({ ctx, db, record }: SurfaceContext): Promise<RecordExtras> {
  const batch = await db.importBatch.findFirst({ where: { featureRecordId: record.id } });
  if (!batch) return {};
  const summary = (batch.summaryJson ?? {}) as {
    rows?: number;
    errors?: number;
    warnings?: number;
    headers?: string[];
    mappings?: Record<string, string>;
    unmapped?: string[];
    committed?: Record<string, number>;
    message?: string;
  };
  const spec = kindSpec(batch.kind);
  const editable = !batch.committedAt;

  const page = await preview(db, batch.id, { pageSize: 200 });
  const headers = summary.headers ?? [];
  const rows: PreviewRow[] = page.rows.map((row) => ({
    rowNo: row.rowNo,
    values: (row.rawJson ?? {}) as Record<string, unknown>,
    errors: (row.errorsJson ?? []) as { field?: string; message: string }[],
    warnings: (row.warningsJson ?? []) as { field?: string; message: string }[],
    skipped: row.disposition === "skip",
  }));

  const fields: MappingField[] = spec.columns.map((column) => ({
    field: column.field,
    label: column.label,
    required: column.required ?? false,
    header: summary.mappings?.[column.field] ?? null,
  }));
  const profiles = await db.columnMappingProfile.findMany({
    where: { kind: batch.kind },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const source = await db.documentLink.findFirst({
    where: { subjectType: "feature_record", subjectId: record.id, slotKey: "source" },
    orderBy: { createdAt: "desc" },
    include: { document: { select: { id: true, title: true } } },
  });

  return {
    slots: [
      {
        slotKey: "source",
        label: "The spreadsheet",
        required: true,
        satisfied: !!source,
        linkRole: "source",
        ...(source ? { documentId: source.document.id, documentTitle: source.document.title } : {}),
      },
    ],
    slotSubject: { subjectType: "feature_record", subjectId: record.id },
    canUploadSlots: editable,
    slotsLabel: "The file",
    panels: [
      {
        key: "rows",
        label: `Rows${summary.errors ? ` (${summary.errors} to fix)` : ""}`,
        content: (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Rows" value={summary.rows ?? 0} />
              <StatCard
                label="With errors"
                value={summary.errors ?? 0}
                tone={summary.errors ? "danger" : "default"}
              />
              <StatCard
                label="With warnings"
                value={summary.warnings ?? 0}
                tone={summary.warnings ? "warning" : "default"}
              />
            </div>
            {summary.message ? (
              <p className="text-sm text-muted-foreground">{summary.message}</p>
            ) : null}
            <PreviewTable
              dept={ctx.deptSlug}
              batchId={batch.id}
              columns={headers}
              rows={rows}
              editable={editable}
            />
          </div>
        ),
      },
      {
        key: "columns",
        label: "Columns",
        content: (
          <MappingEditor
            dept={ctx.deptSlug}
            batchId={batch.id}
            fields={fields}
            headers={headers}
            unmapped={summary.unmapped ?? []}
            profiles={profiles}
          />
        ),
      },
    ],
  };
}
