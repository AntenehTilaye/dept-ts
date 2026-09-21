import type { DeptCtx } from "@/lib/auth/require";
import { actorOf } from "@/lib/auth/require";
import type { Db } from "@/lib/db/types";
import { canContribute } from "@/platform/document";
import { gateFor } from "@/platform/document/gate";
import { list, loadThread, threadAccess } from "@/platform/thread";
import { ThreadPanel, type CommentView } from "./ThreadPanel";

/** Server component: the discussion of a subject (created lazily by the first post). */
export async function SubjectThread({
  ctx,
  db,
  subject,
  kind = "comments",
  path,
}: {
  ctx: DeptCtx;
  db: Db;
  subject: { subjectType: string; subjectId: string };
  kind?: "comments" | "revision_notes";
  path?: string;
}) {
  const actor = actorOf(ctx);
  const gate = gateFor(db, actor);
  const thread = await db.thread.findUnique({
    where: {
      subjectType_subjectId_kind: {
        subjectType: subject.subjectType as never,
        subjectId: subject.subjectId,
        kind,
      },
    },
  });
  const contribute = await canContribute(gate, subject);
  let comments: CommentView[] = [];
  let reviewer = false;
  if (thread) {
    const full = (await loadThread(db, thread.id))!;
    const access = await threadAccess(db, actor, full);
    reviewer = access.reviewer;
    if (access.allowed) {
      comments = (await list(db, actor, thread.id)).map((c) => ({
        id: c.id,
        authorName: c.author.fullName,
        authorPersonId: c.authorPersonId,
        body: c.body,
        visibility: c.visibility,
        createdAt: c.createdAt.toISOString(),
      }));
    }
  } else {
    reviewer = actor.isAdmin || (await gate.can("document.manage", subject, "manage"));
  }
  return (
    <ThreadPanel
      dept={ctx.deptSlug}
      subject={subject}
      kind={kind}
      threadId={thread?.id ?? null}
      status={thread?.status ?? "open"}
      comments={comments}
      canPost={contribute.allowed && !!actor.personId}
      canReviewerNotes={reviewer}
      canClose={reviewer}
      path={path}
    />
  );
}
