import type { Relationship } from "../identity/levels";
import { register } from "../subject-registry";
import { assigneePersonIds } from "./assignments";

// SubjectRegistry registrations for tasks and their case extension. A task's context (its
// committee, offering, meeting, ...) is inherited through `parentRef`, so a committee-scoped
// grant covers the committee's tasks without any extra rule.

export function registerWorkItemSubjects(): void {
  register("task", {
    label: async (db, id) => (await db.task.findUnique({ where: { id } }))?.title ?? null,
    snapshot: async (db, id) => {
      const t = await db.task.findUnique({ where: { id } });
      if (!t) return null;
      const instance = await db.workflowInstance.findFirst({
        where: { subjectType: "task", subjectId: id },
        select: { currentState: true },
      });
      return {
        label: t.title,
        status: instance?.currentState ?? undefined,
        departmentId: t.departmentId,
        data: { kind: t.kind, dueAt: t.dueAt, priority: t.priority },
      };
    },
    contextOf: async (db, id) => {
      const t = await db.task.findUnique({ where: { id } });
      if (!t) return null;
      const creator = await db.person.findFirst({
        where: { userId: t.createdBy },
        select: { id: true },
      });
      return {
        departmentId: t.departmentId,
        ...(creator ? { ownerPersonId: creator.id } : {}),
        ...(t.contextType && t.contextId
          ? { parentRef: { subjectType: t.contextType, subjectId: t.contextId } }
          : {}),
      };
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const t = await db.task.findUnique({ where: { id }, select: { createdBy: true } });
      if (!t) return [];
      const rels: Relationship[] = [];
      const person = await db.person.findUnique({
        where: { id: personId },
        select: { userId: true },
      });
      if (person?.userId && person.userId === t.createdBy)
        rels.push("owner", "creator", "reviewer");
      if ((await assigneePersonIds(db, id)).includes(personId)) rels.push("assignee");
      return rels;
    },
    variables: async (db, id) => {
      const t = await db.task.findUnique({ where: { id } });
      return t
        ? {
            task_title: t.title,
            title: t.title,
            due_date: t.dueAt ? t.dueAt.toISOString().slice(0, 10) : "",
            priority: t.priority,
          }
        : {};
    },
    indexDoc: async (db, id) => {
      const t = await db.task.findUnique({ where: { id } });
      return t ? { title: t.title, body: t.description ?? "", keywords: [t.kind] } : null;
    },
    url: (id, slug) => `/d/${slug}/tasks/${id}`,
  });

  register("case", {
    label: async (db, id) => {
      const c = await db.case.findUnique({ where: { taskId: id }, include: { task: true } });
      return c?.task.title ?? null;
    },
    snapshot: async (db, id) => {
      const c = await db.case.findUnique({ where: { taskId: id }, include: { task: true } });
      return c
        ? {
            label: c.task.title,
            departmentId: c.departmentId,
            data: { issue: c.issue, category: c.issueCategory },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const c = await db.case.findUnique({ where: { taskId: id } });
      return c
        ? {
            departmentId: c.departmentId,
            ...(c.sectionId ? { sectionId: c.sectionId } : {}),
            parentRef: { subjectType: "task", subjectId: id },
          }
        : null;
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const c = await db.case.findUnique({ where: { taskId: id } });
      return c && c.requesterPersonId === personId ? ["requester"] : [];
    },
    url: (id, slug) => `/d/${slug}/tasks/${id}`,
  });
}
