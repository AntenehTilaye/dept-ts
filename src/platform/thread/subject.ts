import type { Relationship } from "../identity/levels";
import { contextOf, register, registerDeletionCascade } from "../subject-registry";

// SubjectRegistry registrations for threads and comments: both inherit their context from the
// thread's subject, so a comment on a task is scoped like the task.

export function registerThreadSubjects(): void {
  register("thread", {
    label: async (db, id) => {
      const t = await db.thread.findUnique({ where: { id } });
      return t ? (t.title ?? `${t.kind} thread`) : null;
    },
    snapshot: async (db, id) => {
      const t = await db.thread.findUnique({ where: { id } });
      return t
        ? {
            label: t.title ?? `${t.kind} thread`,
            status: t.status,
            departmentId: t.departmentId,
            data: { kind: t.kind, subjectType: t.subjectType, subjectId: t.subjectId },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const t = await db.thread.findUnique({ where: { id } });
      if (!t) return null;
      return {
        departmentId: t.departmentId,
        ...(t.participantGroupId ? { groupId: t.participantGroupId } : {}),
        ...(t.sectionId ? { sectionId: t.sectionId } : {}),
        ...(t.subjectType && t.subjectId
          ? { parentRef: { subjectType: t.subjectType, subjectId: t.subjectId } }
          : {}),
      };
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const t = await db.thread.findUnique({
        where: { id },
        include: { participantGroup: { include: { members: { where: { personId } } } } },
      });
      if (!t) return [];
      const rels: Relationship[] = [];
      if (t.participantGroup?.members.length) rels.push("participant");
      return rels;
    },
    url: (id, slug) => `/d/${slug}/threads/${id}`,
  });

  register("comment", {
    label: async (db, id) => {
      const c = await db.comment.findUnique({ where: { id }, include: { thread: true } });
      return c ? `Comment in ${c.thread.title ?? `${c.thread.kind} thread`}` : null;
    },
    snapshot: async (db, id) => {
      const c = await db.comment.findUnique({ where: { id } });
      return c
        ? {
            label: c.body.slice(0, 80),
            departmentId: c.departmentId,
            data: { threadId: c.threadId },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const c = await db.comment.findUnique({ where: { id } });
      if (!c) return null;
      const parent = await contextOf(db, { subjectType: "thread", subjectId: c.threadId });
      return { ...parent, departmentId: c.departmentId, ownerPersonId: c.authorPersonId };
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const c = await db.comment.findUnique({ where: { id }, select: { authorPersonId: true } });
      return c && c.authorPersonId === personId ? ["owner", "creator"] : [];
    },
  });

  // a deleted subject closes its threads (history stays readable through the department)
  registerDeletionCascade("thread.close", async (db, ref) => {
    await db.thread.updateMany({
      where: { subjectType: ref.subjectType as never, subjectId: ref.subjectId, status: "open" },
      data: { status: "closed" },
    });
  });
}
