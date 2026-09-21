"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { actorOf } from "@/lib/auth/require";
import { downloadUrl, get, softDelete } from "@/platform/document";
import { searchPersons } from "@/platform/people/persons";
import { close, getOrCreateThread, list, post, reopen } from "@/platform/thread";

// Server actions behind the document and discussion components. Every one carries the
// department slug (safeAction) and runs on the department transaction with the caller's actor.

/** A fresh signed link; the browser navigates to it immediately. */
export const downloadUrlAction = safeAction(
  z.object({
    documentId: z.string().min(1),
    versionNo: z.coerce.number().int().positive().optional(),
  }),
  async ({ input, ctx, db }) => downloadUrl(db, actorOf(ctx), input.documentId, input.versionNo),
);

/** Version history and links of one document (for the dialog). */
export const documentDetailAction = safeAction(
  z.object({ documentId: z.string().min(1) }),
  async ({ input, ctx, db }) => {
    const doc = await get(db, actorOf(ctx), input.documentId);
    return {
      id: doc.id,
      title: doc.title,
      currentVersionNo: doc.currentVersionNo,
      versions: doc.versions.map((v) => ({
        versionNo: v.versionNo,
        originalName: v.originalName,
        mimeType: v.mimeType,
        sizeBytes: v.sizeBytes,
        uploadedAt: v.uploadedAt.toISOString(),
        note: v.note,
        locked: !!v.lockedAt,
      })),
      links: doc.links.map((l) => ({
        subjectType: l.subjectType,
        subjectId: l.subjectId,
        linkRole: l.linkRole,
        slotKey: l.slotKey,
      })),
    };
  },
);

export const deleteDocumentAction = safeAction(
  z.object({ documentId: z.string().min(1), path: z.string().optional() }),
  async ({ input, ctx, db }) => {
    await softDelete(db, actorOf(ctx), input.documentId);
    revalidatePath(input.path ?? `/d/${ctx.deptSlug}/documents`);
    return { id: input.documentId };
  },
);

/** People the composer may mention (department directory, name or email prefix). */
export const mentionCandidatesAction = safeAction(
  z.object({ q: z.string().max(80) }),
  async ({ input, ctx, db }) => {
    if (input.q.trim().length < 1) return [];
    const rows = await searchPersons(db, ctx.departmentId, { q: input.q.trim() });
    return rows.slice(0, 8).map((p) => ({ id: p.id, name: p.fullName, email: p.email }));
  },
);

const SubjectSchema = z.object({
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  kind: z.enum(["comments", "revision_notes"]).default("comments"),
});

export const postCommentAction = safeAction(
  SubjectSchema.extend({
    body: z.string().trim().min(1).max(5000),
    visibility: z.enum(["all", "reviewers_only", "internal"]).default("all"),
    path: z.string().optional(),
  }),
  async ({ input, ctx, db }) => {
    const actor = actorOf(ctx);
    const thread = await getOrCreateThread(
      db,
      ctx.departmentId,
      { subjectType: input.subjectType, subjectId: input.subjectId },
      input.kind,
      ctx.user.id,
    );
    const comment = await post(db, actor, {
      threadId: thread.id,
      body: input.body,
      visibility: input.visibility,
    });
    if (input.path) revalidatePath(input.path);
    return { id: comment.id, threadId: thread.id };
  },
);

export const listCommentsAction = safeAction(
  z.object({ threadId: z.string().min(1) }),
  async ({ input, ctx, db }) => list(db, actorOf(ctx), input.threadId),
);

export const setThreadStatusAction = safeAction(
  z.object({
    threadId: z.string().min(1),
    status: z.enum(["open", "closed"]),
    path: z.string().optional(),
  }),
  async ({ input, ctx, db }) => {
    const actor = actorOf(ctx);
    if (input.status === "closed") await close(db, actor, input.threadId);
    else await reopen(db, actor, input.threadId);
    if (input.path) revalidatePath(input.path);
    return { threadId: input.threadId, status: input.status };
  },
);
