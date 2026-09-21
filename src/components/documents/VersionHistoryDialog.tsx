"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, LockIcon } from "lucide-react";
import { documentDetailAction } from "@/app/(app)/d/[dept]/(modules)/documents/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadButton } from "./UploadButton";
import { fileKind, formatBytes } from "./DocumentList";

type Detail = Extract<Awaited<ReturnType<typeof documentDetailAction>>, { ok: true }>["data"];

/** Every version of a document, newest first, with per-version download and "upload new version". */
export function VersionHistoryDialog({
  dept,
  documentId,
  onClose,
  onDownload,
}: {
  dept: string;
  documentId: string | null;
  onClose: () => void;
  onDownload: (documentId: string, versionNo: number) => void;
}) {
  // loaded detail is keyed by document id, so switching documents shows the skeleton again
  const [loaded, setLoaded] = useState<{ id: string; detail?: Detail; error?: string } | null>(
    null,
  );
  const detail = loaded?.id === documentId ? loaded.detail : undefined;
  const error = loaded?.id === documentId ? loaded.error : undefined;

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    documentDetailAction({ dept, documentId }).then((r) => {
      if (cancelled) return;
      setLoaded(r.ok ? { id: documentId, detail: r.data } : { id: documentId, error: r.message });
    });
    return () => {
      cancelled = true;
    };
  }, [dept, documentId]);
  const setDetail = (d: Detail) => setLoaded({ id: d.id, detail: d });

  return (
    <Dialog open={!!documentId} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg" data-testid="version-history">
        <DialogHeader>
          <DialogTitle>{detail?.title ?? "Version history"}</DialogTitle>
          <DialogDescription>
            Versions are immutable; a new upload becomes the current version.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!detail && !error ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : null}
        {detail ? (
          <>
            <ol className="divide-y rounded-md border text-sm">
              {detail.versions.map((v) => (
                <li
                  key={v.versionNo}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                  data-testid={`version-${v.versionNo}`}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      v{v.versionNo}
                      {v.versionNo === detail.currentVersionNo ? <Badge>current</Badge> : null}
                      {v.locked ? (
                        <Badge variant="outline">
                          <LockIcon /> locked
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {v.originalName} · {fileKind(v.mimeType)} · {formatBytes(v.sizeBytes)} ·{" "}
                      {v.uploadedAt.slice(0, 16).replace("T", " ")}
                      {v.note ? ` · ${v.note}` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDownload(detail.id, v.versionNo)}
                    aria-label={`Download version ${v.versionNo}`}
                  >
                    <DownloadIcon />
                  </Button>
                </li>
              ))}
            </ol>
            <div className="flex justify-end">
              <UploadButton
                dept={dept}
                documentId={detail.id}
                label="Upload new version"
                onUploaded={() =>
                  documentDetailAction({ dept, documentId: detail.id }).then((r) => {
                    if (r.ok) setDetail(r.data);
                  })
                }
              />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
