import type { ThreadKind, Visibility } from "@/generated/prisma/enums";
import type { Db } from "../../lib/db/types";
import { publish } from "../audit/outbox";
import { canContribute } from "../document/access";
import { gateFor } from "../document/gate";
import { link as linkDocument } from "../document/service";
import type { Actor } from "../identity/can";
import { addMember, createGroup } from "../people/groups";
import { assertExists } from "../subject-registry";
import type { SubjectRef } from "../subject-registry/types";
import { ThreadAccessError, ThreadClosedError, ThreadNotFoundError } from "./errors";
import { extractMentions } from "./mentions";

// The one discussion service. A subject thread (comments, revision notes) is readable and
// writable by whoever may contribute to its subject (document/access.ts); a conversation by
// its participant group. `reviewers_only` posts need a reviewer/chair relationship or
// document.manage on the subject; `internal` posts are hidden from students and externals.

export type ThreadRow = NonNullable<Awaited<ReturnType<typeof loadThread>>>;

export async function loadThread(db: Db, threadId: string) {
  return db.thread.findUnique({
    where: { id: threadId },
    include: { participantGroup: { include: { members: true } } },
  });
}

async function requireThread(db: Db, threadId: string): Promise<ThreadRow> {
  const t = await loadThread(db, threadId);
  if (!t) throw new ThreadNotFoundError(threadId);
  return t;
}

function subjectOf(t: ThreadRow): SubjectRef | null {
  return t.subjectType && t.subjectId
    ? { subjectType: t.subjectType, subjectId: t.subjectId }
    : null;
}

function isParticipant(t: ThreadRow, personId: string | null, now = new Date()): boolean {
  if (!personId) return false;
  return !!t.participantGroup?.members.some(
    (m) => m.personId === personId && m.validFrom <= now && (m.validTo === null || m.validTo > now),
  );
}

/** Whether the actor may read and post in the thread, with the reason. */
export async function threadAccess(
  db: Db,
  actor: Actor,
  t: ThreadRow,
): Promise<{ allowed: boolean; reason: string; reviewer: boolean }> {
  const gate = gateFor(db, actor);
  const subject = subjectOf(t);
  const manage = subject
    ? await gate.can("document.manage", subject, "manage")
    : await gate.can("document.manage", undefined, "manage");
  const rels = subject ? await gate.relationships(subject) : [];
  const reviewer = actor.isAdmin || manage || rels.includes("reviewer") || rels.includes("chair");
  if (actor.isAdmin) return { allowed: true, reason: "administrator", reviewer };
  if (isParticipant(t, actor.personId)) return { allowed: true, reason: "participant", reviewer };
  if (subject) {
    const d = await canContribute(gate, subject);
    return { ...d, reviewer };
  }
  if (manage) return { allowed: true, reason: "document.manage", reviewer };
  return { allowed: false, reason: "not a participant", reviewer };
}

export async function getOrCreateThread(
  db: Db,
  departmentId: string,
  subject: SubjectRef,
  kind: ThreadKind,
  openedBy: string,
  title?: string | null,
) {
  await assertExists(db, subject);
  const existing = await db.thread.findUnique({
    where: {
      subjectType_subjectId_kind: {
        subjectType: subject.subjectType as never,
        subjectId: subject.subjectId,
        kind,
      },
    },
  });
  if (existing) return existing;
  return db.thread.create({
    data: {
      departmentId,
      subjectType: subject.subjectType as never,
      subjectId: subject.subjectId,
      kind,
      title: title ?? null,
      openedBy,
    },
  });
}

export interface ConversationInput {
  title: string;
  participantPersonIds?: string[];
  groupId?: string | null;
  sectionId?: string | null;
  subject?: SubjectRef | null;
}

/** A two-way conversation between explicit participants (or an existing group). */
export async function openConversation(db: Db, actor: Actor, input: ConversationInput) {
  let groupId = input.groupId ?? null;
  if (!groupId) {
    const ids = new Set(input.participantPersonIds ?? []);
    if (actor.personId) ids.add(actor.personId);
    const group = await createGroup(db, actor.departmentId, {
      kind: "adhoc",
      name: `Conversation: ${input.title}`,
    });
    for (const personId of ids) await addMember(db, actor.departmentId, group.id, { personId });
    groupId = group.id;
  }
  if (input.subject) await assertExists(db, input.subject);
  return db.thread.create({
    data: {
      departmentId: actor.departmentId,
      kind: "conversation",
      title: input.title,
      participantGroupId: groupId,
      sectionId: input.sectionId ?? null,
      subjectType: (input.subject?.subjectType ?? null) as never,
      subjectId: input.subject?.subjectId ?? null,
      openedBy: actor.userId,
    },
  });
}

export interface PostInput {
  threadId: string;
  body: string;
  visibility?: Visibility;
  /** Document ids to attach (linked to the comment as attachments). */
  attachments?: string[];
}

export async function post(db: Db, actor: Actor, input: PostInput) {
  if (!actor.personId) throw new ThreadAccessError("Your account is not linked to a person");
  const t = await requireThread(db, input.threadId);
  if (t.status === "closed") throw new ThreadClosedError(t.id);
  const access = await threadAccess(db, actor, t);
  if (!access.allowed) throw new ThreadAccessError(access.reason);
  const visibility = input.visibility ?? "all";
  if (visibility === "reviewers_only" && !access.reviewer)
    throw new ThreadAccessError("Only reviewers may post reviewer-only notes");
  const body = input.body.trim();
  if (!body) throw new ThreadAccessError("An empty comment cannot be posted");
  // only persons known to the department can be mentioned
  const wanted = extractMentions(body).map((m) => m.personId);
  const known = wanted.length
    ? (
        await db.departmentPerson.findMany({
          where: { departmentId: t.departmentId, personId: { in: wanted } },
          select: { personId: true },
        })
      ).map((r) => r.personId)
    : [];
  const mentions = wanted.filter((id) => known.includes(id) && id !== actor.personId);
  const comment = await db.comment.create({
    data: {
      departmentId: t.departmentId,
      threadId: t.id,
      authorPersonId: actor.personId,
      body,
      visibility,
      mentions,
    },
  });
  for (const documentId of input.attachments ?? []) {
    await linkDocument(db, actor, documentId, [
      { subjectType: "comment", subjectId: comment.id, linkRole: "attachment" },
    ]);
  }
  await db.thread.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
  await publish(
    db,
    "comment.posted",
    { subjectType: "comment", subjectId: comment.id },
    {
      commentId: comment.id,
      threadId: t.id,
      threadKind: t.kind,
      authorPersonId: actor.personId,
      mentions,
      visibility,
      subject: subjectOf(t),
    },
    { departmentId: t.departmentId },
  );
  return comment;
}

/** Comments the actor may see, oldest first. */
export async function list(db: Db, actor: Actor, threadId: string) {
  const t = await requireThread(db, threadId);
  const access = await threadAccess(db, actor, t);
  if (!access.allowed) throw new ThreadAccessError(access.reason);
  const person = actor.personId
    ? await db.person.findUnique({ where: { id: actor.personId }, select: { type: true } })
    : null;
  const staffLike = actor.isAdmin || person?.type === "staff";
  const rows = await db.comment.findMany({
    where: { threadId },
    include: { author: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.filter((c) => {
    if (c.visibility === "reviewers_only") return access.reviewer;
    if (c.visibility === "internal") return staffLike;
    return true;
  });
}

export async function close(db: Db, actor: Actor, threadId: string) {
  const t = await requireThread(db, threadId);
  const access = await threadAccess(db, actor, t);
  if (!access.allowed) throw new ThreadAccessError(access.reason);
  return db.thread.update({ where: { id: threadId }, data: { status: "closed" } });
}

export async function reopen(db: Db, actor: Actor, threadId: string) {
  const t = await requireThread(db, threadId);
  const access = await threadAccess(db, actor, t);
  if (!access.allowed) throw new ThreadAccessError(access.reason);
  return db.thread.update({ where: { id: threadId }, data: { status: "open" } });
}

/** Open threads of a section (the representative conversations of the communication phase). */
export async function threadsOfSection(db: Db, sectionId: string) {
  return db.thread.findMany({
    where: { sectionId, status: "open" },
    orderBy: { updatedAt: "desc" },
  });
}
