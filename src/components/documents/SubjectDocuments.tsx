import type { DeptCtx } from "@/lib/auth/require";
import { actorOf } from "@/lib/auth/require";
import type { Db } from "@/lib/db/types";
import { accessView, canContribute, canManageDocument, listFor } from "@/platform/document";
import { gateFor } from "@/platform/document/gate";
import { DocumentList, type DocumentRow } from "./DocumentList";
import { UploadButton } from "./UploadButton";

/** Server component: the documents linked to a subject, with an upload for involved actors. */
export async function SubjectDocuments({
  ctx,
  db,
  subject,
  linkRole = "attachment",
  path,
  emptyHint,
}: {
  ctx: DeptCtx;
  db: Db;
  subject: { subjectType: string; subjectId: string };
  /** Role given to new uploads from this panel. */
  linkRole?: "attachment" | "evidence" | "tor" | "minutes" | "source";
  path?: string;
  emptyHint?: React.ReactNode;
}) {
  const actor = actorOf(ctx);
  const gate = gateFor(db, actor);
  const [docs, contribute] = await Promise.all([
    listFor(db, actor, subject),
    canContribute(gate, subject),
  ]);
  const rows: DocumentRow[] = [];
  for (const { link, document } of docs) {
    const current = document.versions[0];
    if (!current) continue;
    rows.push({
      id: document.id,
      title: document.title,
      currentVersionNo: document.currentVersionNo,
      mimeType: current.mimeType,
      sizeBytes: current.sizeBytes,
      uploadedAt: current.uploadedAt.toISOString(),
      linkRole: link.linkRole,
      slotKey: link.slotKey || undefined,
      category: document.category,
      canManage: (await canManageDocument(gate, accessView(document))).allowed,
    });
  }
  return (
    <div className="flex flex-col gap-3">
      {contribute.allowed ? (
        <div className="flex justify-end">
          <UploadButton
            dept={ctx.deptSlug}
            links={[{ ...subject, linkRole }]}
            label="Upload a file"
          />
        </div>
      ) : null}
      <DocumentList
        dept={ctx.deptSlug}
        rows={rows}
        path={path}
        emptyHint={
          emptyHint ??
          "Files attached here are versioned and downloadable by everyone who may read this page."
        }
      />
    </div>
  );
}
