import type { TaskKind } from "@/generated/prisma/enums";
import type { Db } from "../../lib/db/types";
import { membersOf } from "../people/groups";
import { isOverdue } from "./service";

// Task queries. There is no status column: the state comes from the WorkflowInstance of the
// task, joined here once per page rather than per row.

export interface TaskFilter {
  /** Tasks assigned to this person directly or through a group. */
  assigneePersonId?: string;
  createdByUserId?: string;
  kind?: TaskKind;
  context?: { subjectType: string; subjectId: string };
  /** Workflow states to keep (default: every state). */
  states?: string[];
  /** true = only open (non-terminal), false = only terminal. */
  open?: boolean;
  overdue?: boolean;
  dueBetween?: { from: Date; to: Date };
  search?: string;
  limit?: number;
}

export interface TaskRow {
  id: string;
  /** The FeatureRecord the task is: what its pages are addressed by. */
  recordId: string | null;
  title: string;
  description: string | null;
  kind: TaskKind;
  priority: string;
  dueAt: Date | null;
  completedAt: Date | null;
  createdBy: string;
  contextType: string | null;
  contextId: string | null;
  state: string | null;
  stateLabel: string | null;
  terminal: boolean;
  overdue: boolean;
  assigneeNames: string[];
}

const TERMINAL = new Set(["completed", "cancelled"]);

const STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  assigned: "Assigned",
  in_progress: "In progress",
  submitted: "Submitted",
  under_review: "Under review",
  revision_required: "Revision required",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Group ids a person belongs to right now (assignments through groups). */
async function groupIdsOf(db: Db, personId: string, asOf: Date): Promise<string[]> {
  const rows = await db.groupMembership.findMany({
    where: {
      personId,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    },
    select: { groupId: true },
  });
  return rows.map((r) => r.groupId);
}

export async function listTasks(
  db: Db,
  departmentId: string,
  filter: TaskFilter = {},
  now = new Date(),
): Promise<TaskRow[]> {
  const where: Record<string, unknown> = { departmentId };
  if (filter.kind) where.kind = filter.kind;
  if (filter.createdByUserId) where.createdBy = filter.createdByUserId;
  if (filter.context) {
    where.contextType = filter.context.subjectType;
    where.contextId = filter.context.subjectId;
  }
  if (filter.dueBetween) where.dueAt = { gte: filter.dueBetween.from, lte: filter.dueBetween.to };
  if (filter.search?.trim()) where.title = { contains: filter.search.trim(), mode: "insensitive" };
  if (filter.assigneePersonId) {
    const groupIds = await groupIdsOf(db, filter.assigneePersonId, now);
    where.assignments = {
      some: {
        OR: [
          { assigneeType: "person", assigneeId: filter.assigneePersonId },
          ...(groupIds.length ? [{ assigneeType: "group", assigneeId: { in: groupIds } }] : []),
        ],
      },
    };
  }

  const tasks = await db.task.findMany({
    where,
    include: { assignments: true },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: filter.limit ?? 200,
  });
  if (tasks.length === 0) return [];

  // a task IS a FeatureRecord since the feature kernel, and the record holds the state; a row
  // created before it still has the provisional instance of its own
  const recordIds = tasks.map((t) => t.featureRecordId).filter((id): id is string => !!id);
  const records = recordIds.length
    ? await db.featureRecord.findMany({
        where: { id: { in: recordIds } },
        select: { id: true, currentStateKey: true },
      })
    : [];
  const stateOfRecord = new Map(records.map((r) => [r.id, r.currentStateKey]));
  const instances = await db.workflowInstance.findMany({
    where: { subjectType: "task", subjectId: { in: tasks.map((t) => t.id) } },
    select: { subjectId: true, currentState: true },
  });
  const legacyState = new Map(instances.map((i) => [i.subjectId, i.currentState]));
  const stateOf = new Map(
    tasks.map((t) => [
      t.id,
      (t.featureRecordId ? stateOfRecord.get(t.featureRecordId) : null) ??
        legacyState.get(t.id) ??
        null,
    ]),
  );

  // resolve assignee names in one pass (person assignments and group members)
  const personIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const t of tasks)
    for (const a of t.assignments)
      (a.assigneeType === "person" ? personIds : groupIds).add(a.assigneeId);
  const groupNames = new Map<string, string>();
  if (groupIds.size) {
    for (const g of await db.group.findMany({ where: { id: { in: Array.from(groupIds) } } }))
      groupNames.set(g.id, g.name);
  }
  const personNames = new Map<string, string>();
  if (personIds.size) {
    for (const p of await db.person.findMany({
      where: { id: { in: Array.from(personIds) } },
      select: { id: true, fullName: true },
    }))
      personNames.set(p.id, p.fullName);
  }

  const rows: TaskRow[] = tasks.map((t) => {
    const state = stateOf.get(t.id) ?? null;
    return {
      id: t.id,
      recordId: t.featureRecordId,
      title: t.title,
      description: t.description,
      kind: t.kind,
      priority: t.priority,
      dueAt: t.dueAt,
      completedAt: t.completedAt,
      createdBy: t.createdBy,
      contextType: t.contextType,
      contextId: t.contextId,
      state,
      stateLabel: state ? (STATE_LABELS[state] ?? state) : null,
      terminal: !!state && TERMINAL.has(state),
      overdue: isOverdue(t, state, now),
      assigneeNames: t.assignments.map((a) =>
        a.assigneeType === "person"
          ? (personNames.get(a.assigneeId) ?? "someone")
          : (groupNames.get(a.assigneeId) ?? "a group"),
      ),
    };
  });

  return rows.filter((r) => {
    if (filter.states?.length && (!r.state || !filter.states.includes(r.state))) return false;
    if (filter.open === true && r.terminal) return false;
    if (filter.open === false && !r.terminal) return false;
    if (filter.overdue === true && !r.overdue) return false;
    return true;
  });
}

/** The person's open work, most urgent first. */
export async function myWork(
  db: Db,
  departmentId: string,
  personId: string,
  now = new Date(),
): Promise<TaskRow[]> {
  const rows = await listTasks(db, departmentId, { assigneePersonId: personId, open: true }, now);
  return rows.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const ad = a.dueAt?.getTime() ?? Infinity;
    const bd = b.dueAt?.getTime() ?? Infinity;
    return ad - bd;
  });
}

/** Counts for the dashboard tiles: open, overdue, waiting for review. */
export async function workCounts(
  db: Db,
  departmentId: string,
  personId: string,
  now = new Date(),
): Promise<{ open: number; overdue: number; inReview: number }> {
  const rows = await listTasks(db, departmentId, { assigneePersonId: personId }, now);
  return {
    open: rows.filter((r) => !r.terminal).length,
    overdue: rows.filter((r) => r.overdue).length,
    inReview: rows.filter((r) => r.state === "submitted" || r.state === "under_review").length,
  };
}

/** Members of the groups a task is assigned to (used by the acknowledgement tab). */
export async function assigneeDetail(db: Db, taskId: string, asOf = new Date()) {
  const rows = await db.taskAssignment.findMany({ where: { taskId } });
  const out: Array<{ personId: string; name: string; role: string; via: string | null }> = [];
  for (const a of rows) {
    if (a.assigneeType === "person") {
      const p = await db.person.findUnique({
        where: { id: a.assigneeId },
        select: { fullName: true },
      });
      out.push({ personId: a.assigneeId, name: p?.fullName ?? "someone", role: a.role, via: null });
      continue;
    }
    const group = await db.group.findUnique({ where: { id: a.assigneeId } });
    for (const m of await membersOf(db, a.assigneeId, asOf)) {
      out.push({
        personId: m.personId,
        name: m.person?.fullName ?? "someone",
        role: a.role,
        via: group?.name ?? "a group",
      });
    }
  }
  return out;
}
