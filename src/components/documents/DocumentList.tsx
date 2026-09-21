"use client";

import { useState, useTransition } from "react";
import { DownloadIcon, FileIcon, HistoryIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  deleteDocumentAction,
  downloadUrlAction,
} from "@/app/(app)/d/[dept]/(modules)/documents/actions";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VersionHistoryDialog } from "./VersionHistoryDialog";

export interface DocumentRow {
  id: string;
  title: string;
  currentVersionNo: number;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  linkRole?: string;
  slotKey?: string;
  category?: string | null;
  canManage: boolean;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

export function fileKind(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.includes("spreadsheet")) return "Spreadsheet";
  if (mimeType.includes("wordprocessing")) return "Document";
  if (mimeType === "text/csv") return "CSV";
  return "Text";
}

/** Rows of documents with download (fresh signed link per click), history and delete. */
export function DocumentList({
  dept,
  rows,
  emptyTitle = "No documents yet",
  emptyHint,
  path,
}: {
  dept: string;
  rows: DocumentRow[];
  emptyTitle?: string;
  emptyHint?: React.ReactNode;
  /** Path to revalidate after a delete (the hosting page). */
  path?: string;
}) {
  const [history, setHistory] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function download(documentId: string, versionNo?: number) {
    start(async () => {
      const r = await downloadUrlAction({ dept, documentId, versionNo });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      window.location.assign(r.data.url);
    });
  }

  function remove(documentId: string, title: string) {
    if (!window.confirm(`Delete "${title}"? It can be restored by an administrator for a while.`))
      return;
    start(async () => {
      const r = await deleteDocumentAction({ dept, documentId, path });
      if (!r.ok) toast.error(r.message);
      else toast.success("Document deleted");
    });
  }

  if (rows.length === 0)
    return <EmptyState compact icon={<FileIcon />} title={emptyTitle} hint={emptyHint} />;

  return (
    <>
      <ul className="divide-y rounded-md border" data-testid="document-list">
        {rows.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            data-testid={`document-${d.id}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate font-medium">{d.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {fileKind(d.mimeType)} · {formatBytes(d.sizeBytes)} · v{d.currentVersionNo} ·{" "}
                  {new Date(d.uploadedAt).toISOString().slice(0, 10)}
                  {d.slotKey ? ` · slot ${d.slotKey}` : ""}
                </p>
              </div>
              {d.linkRole && d.linkRole !== "attachment" ? (
                <Badge variant="outline">{d.linkRole}</Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => download(d.id)}
                aria-label={`Download ${d.title}`}
              >
                <DownloadIcon /> Download
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setHistory(d.id)}
                aria-label={`Version history of ${d.title}`}
              >
                <HistoryIcon /> History
              </Button>
              {d.canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  onClick={() => remove(d.id, d.title)}
                  aria-label={`Delete ${d.title}`}
                >
                  <Trash2Icon className="text-destructive" />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <VersionHistoryDialog
        dept={dept}
        documentId={history}
        onClose={() => setHistory(null)}
        onDownload={download}
      />
    </>
  );
}
