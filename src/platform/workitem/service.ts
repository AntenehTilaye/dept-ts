import type { Priority, TaskKind } from "@/generated/prisma/enums";
import { fromJson, toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { publish } from "../audit/outbox";
import { slotStatus } from "../document/links";
import type { Actor } from "../identity/can";
import { ackStatus } from "../scheduler/inbox";
import { notify } from "../scheduler/notify";
import { cancelBySubject, subscribeReminders } from "../scheduler/reminders";
import { cancelByPrefix } from "../scheduler/ledger";
import { applyIn, availableActions, instanceOf, start } from "../workflow/engine";
import { TASK_DEFINITION_KEY } from "../workflow/definitions/task";
import { addAssignees, assigneePersonIds, type AssigneeSpec } from "./assignments";
import { nextOccurrence, RecurrenceSpec } from "./recurrence";

// The Work Item service: one Task table for every task-like thing. The lifecycle lives in the
// WorkflowInstance whose subject is the task (no status column); acknowledgement is the
// assignment Notification; deliverables are DocumentLink(deliverable, slotKey) rows.

export interface DeliverableSlot {
  key: string;
  label: string;
  required?: boolean;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  kind?: TaskKind;
  priority?: Priority;
  context?: { subjectType: string; subjectId: string } | null;
  parentTaskId?: string | null;
  assignees?: AssigneeSpec[];
  startDate?: Date | null;
  dueAt?: Date | null;
  deadlineAnchor?: unknown;
  expectedDeliverables?: DeliverableSlot[];
  reminderScheduleKey?: string | null;
  recurrence?: RecurrenceSpec | null;
  /** Skip the assign transition (drafts created by a wizard). */
  keepDraft?: boolean;
}

export const DEFAULT_TASK_REMINDER_SCHEDULE = "default_7_3_1_0_overdue";

/** The task's workflow instance (the single owner of its lifecycle state). */
export async function taskInstance(db: Db, taskId: string) {
  return instanceOf(db, { subjectType: "task", subjectId: taskId }, TASK_DEFINITION_KEY);
}

export async function taskOf(db: Db, taskId: string) {
  return db.task.findUnique({ where: { id: taskId }, include: { assignments: true } });
}

function slotsOf(task: { expectedDeliverablesJson: unknown }): DeliverableSlot[] {
  const raw = fromJson<DeliverableSlot[]>(task.expectedDeliverablesJson as never);
  return Array.isArray(raw) ? raw : [];
}

/**
 * Creates a task, starts its workflow, assigns it (notifying every assignee with an
 * ack-required notification) and subscribes the deadline reminders.
 */
export async function createTask(db: Db, actor: Actor, input: CreateTaskInput) {
  const recurrenceRule = input.recurrence
    ? await db.recurrenceRule.create({
        data: {
          departmentId: actor.departmentId,
          frequency: input.recurrence.frequency,
          interval: input.recurrence.interval,
          byWeekday: input.recurrence.byWeekday,
          byMonthDay: input.recurrence.byMonthDay ?? null,
          startsOn: input.recurrence.startsOn,
          endsOn: input.recurrence.endsOn ?? null,
          count: input.recurrence.count ?? null,
          timezone: input.recurrence.timezone,
          nextSpawnAt: nextOccurrence(input.recurrence, input.recurrence.startsOn, 1),
        },
      })
    : null;

  const task = await db.task.create({
    data: {
      departmentId: actor.departmentId,
      title: input.title.trim(),
      description: input.description ?? null,
      kind: input.kind ?? "general",
      priority: input.priority ?? "normal",
      contextType: (input.context?.subjectType ?? null) as never,
      contextId: input.context?.subjectId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      createdBy: actor.userId,
      startDate: input.startDate ?? null,
      dueAt: input.dueAt ?? null,
      deadlineAnchorJson: input.deadlineAnchor ? toJson(input.deadlineAnchor) : undefined,
      expectedDeliverablesJson: toJson(input.expectedDeliverables ?? []),
      recurrenceRuleId: recurrenceRule?.id ?? null,
      reminderScheduleKey:
        input.reminderScheduleKey === undefined
          ? DEFAULT_TASK_REMINDER_SCHEDULE
          : input.reminderScheduleKey,
    },
  });
  if (recurrenceRule)
    await db.recurrenceRule.update({
      where: { id: recurrenceRule.id },
      data: { templateTaskId: task.id },
    });

  const subject = { subjectType: "task", subjectId: task.id };
  await start(db, {
    definitionKey: TASK_DEFINITION_KEY,
    subject,
    departmentId: actor.departmentId,
    actor,
    dueAt: input.dueAt ?? null,
  });
  const assignments = input.assignees?.length
    ? await addAssignees(db, actor.departmentId, task.id, input.assignees, task.title)
    : [];

  await publish(
    db,
    "task.created",
    subject,
    { taskId: task.id, kind: task.kind, dueAt: task.dueAt },
    { departmentId: actor.departmentId },
  );

  if (assignments.length && !input.keepDraft) {
    await transition(db, actor, task.id, "assign");
    if (task.dueAt && task.reminderScheduleKey)
      await subscribeTaskReminders(
        db,
        actor.departmentId,
        task.id,
        task.dueAt,
        task.reminderScheduleKey,
      );
  }
  return (await taskOf(db, task.id))!;
}

async function subscribeTaskReminders(
  db: Db,
  departmentId: string,
  taskId: string,
  dueAt: Date,
  scheduleKey: string,
) {
  const persons = await assigneePersonIds(db, taskId);
  if (!persons.length) return;
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  await subscribeReminders(db, departmentId, {
    subject: { subjectType: "task", subjectId: taskId },
    scheduleKey,
    deadline: { at: dueAt },
    audienceSpec: { persons },
    variables: { title: task.title, task_title: task.title },
  });
}

/** The actions the actor may take on a task right now. */
export async function actionsFor(db: Db, actor: Actor, taskId: string) {
  const instance = await taskInstance(db, taskId);
  if (!instance) return { instance: null, actions: [] };
  return { instance, actions: await availableActions(db, instance.id, actor) };
}

export interface TransitionInput {
  comment?: string;
  fields?: Record<string, unknown>;
  expectedState?: string;
  system?: boolean;
}

/** Applies a task action by name (the transition key is `<state>.<action>`). */
export async function transition(
  db: Db,
  actor: Actor | null,
  taskId: string,
  action: string,
  input: TransitionInput = {},
) {
  const instance = await taskInstance(db, taskId);
  if (!instance) throw new Error(`Task ${taskId} has no workflow instance`);
  return applyIn(db, instance.id, `${instance.currentState}.${action}`, actor, {
    comment: input.comment,
    fields: input.fields,
    expectedState: input.expectedState,
    system: input.system,
  });
}

/** Adds assignees to an existing task (and re-subscribes the reminders to the new audience). */
export async function assign(db: Db, actor: Actor, taskId: string, assignees: AssigneeSpec[]) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const added = await addAssignees(db, actor.departmentId, taskId, assignees, task.title);
  const instance = await taskInstance(db, taskId);
  if (instance?.currentState === "draft") await transition(db, actor, taskId, "assign");
  else await notifyAssignment(db, actor, taskId);
  if (task.dueAt && task.reminderScheduleKey)
    await subscribeTaskReminders(
      db,
      actor.departmentId,
      taskId,
      task.dueAt,
      task.reminderScheduleKey,
    );
  return added;
}

/** Ack-required assignment notification for the current assignees (idempotent per task+state). */
async function notifyAssignment(db: Db, actor: Actor, taskId: string) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const persons = await assigneePersonIds(db, taskId);
  if (!persons.length) return;
  await notify(db, task.departmentId, {
    recipients: persons,
    templateKey: "task_assignment",
    category: "assignment",
    subject: { subjectType: "task", subjectId: taskId },
    actionUrl: null,
    ackRequired: true,
    declinable: true,
    dedupeKey: `task:${taskId}:assignment`,
    variables: {
      title: task.title,
      due_date: task.dueAt ? task.dueAt.toISOString().slice(0, 10) : "",
    },
  });
}

/** Moves the deadline: cancels the old reminder keys and subscribes new ones. */
export async function setDeadline(
  db: Db,
  actor: Actor,
  taskId: string,
  dueAt: Date | null,
): Promise<void> {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  await db.task.update({ where: { id: taskId }, data: { dueAt } });
  const subject = { subjectType: "task", subjectId: taskId };
  await cancelBySubject(db, subject);
  await cancelByPrefix(db, `task:${taskId}:`);
  if (dueAt && task.reminderScheduleKey)
    await subscribeTaskReminders(db, actor.departmentId, taskId, dueAt, task.reminderScheduleKey);
  const instance = await taskInstance(db, taskId);
  if (instance) await db.workflowInstance.update({ where: { id: instance.id }, data: { dueAt } });
  await publish(
    db,
    "task.deadline_changed",
    subject,
    { taskId, dueAt },
    {
      departmentId: task.departmentId,
    },
  );
}

/** Who acknowledged or declined the assignment. */
export async function acknowledgements(db: Db, taskId: string) {
  return ackStatus(db, { subjectType: "task", subjectId: taskId });
}

/** Which expected deliverable slots hold a document. */
export async function deliverableStatus(db: Db, taskId: string) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const slots = slotsOf(task);
  if (!slots.length) return [];
  const status = await slotStatus(
    db,
    { subjectType: "task", subjectId: taskId },
    slots.map((s) => s.key),
  );
  return slots.map((s) => ({
    ...s,
    required: s.required ?? false,
    ...status.find((x) => x.slotKey === s.key)!,
  }));
}

/** Nudges the responsible assignees for an update. */
export async function requestUpdate(
  db: Db,
  actor: Actor,
  taskId: string,
  message: string,
): Promise<number> {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const persons = await assigneePersonIds(db, taskId, "responsible");
  if (!persons.length) return 0;
  const result = await notify(db, task.departmentId, {
    recipients: persons,
    templateKey: "task_update_request",
    category: "assignment",
    subject: { subjectType: "task", subjectId: taskId },
    dedupeKey: `task:${taskId}:update:${new Date().toISOString().slice(0, 16)}`,
    variables: { title: task.title, comment: message },
  });
  return result.created.length;
}

/** True when the task is past its deadline and not in a terminal state (never stored). */
export function isOverdue(
  task: { dueAt: Date | null; completedAt: Date | null },
  state: string | null,
  now = new Date(),
): boolean {
  if (!task.dueAt || task.completedAt) return false;
  if (state && (state === "completed" || state === "cancelled")) return false;
  return task.dueAt.getTime() < now.getTime();
}
