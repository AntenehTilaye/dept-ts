import type { AssigneeType, FeatureStepStatus } from "@/generated/prisma/enums";
import { toJson } from "../../../lib/db/json";
import type { Db } from "../../../lib/db/types";
import type { Actor } from "../../identity/can";
import { resolveTermAnchor } from "../../academic/calendar";
import { cancelByPrefix } from "../../scheduler/ledger";
import { notify } from "../../scheduler/notify";
import { cancelBySubject, subscribeReminders } from "../../scheduler/reminders";
import { enqueue } from "../../scheduler/enqueue";
import { createTask } from "../../workitem/service";
import { addAssignees } from "../../workitem/assignments";
import { runAdapter, getAdapter } from "../adapters/registry";
import { audienceArgs, type AutoTrigger } from "../compile";
import { branchesOf, type DeadlineRule, type StepDef } from "../schema";
import { branchLeaves } from "../tree";
import { resolveAssignee, type Assignee } from "./assign";
import { definitionOfRecord, type ResolvedDefinition } from "./queries";

// Entering and leaving a step is where a feature actually happens: the step instance is created,
// somebody is assigned, a task appears in their work list, the deadline is computed, reminders
// are subscribed and the notifications go out. These functions are the only writers of the
// derived caches on FeatureRecord — every other caller goes through a transition.

const DAY = 86_400_000;

export interface StepContext {
  tx: Db;
  actor: Actor | null;
  record: RecordRow;
  resolved: ResolvedDefinition;
}

export interface RecordRow {
  id: string;
  departmentId: string;
  definitionId: string;
  definitionVersionId: string;
  number: string;
  title: string;
  data: unknown;
  presetKey: string | null;
  parentSubjectType: string | null;
  parentSubjectId: string | null;
  ownerPersonId: string;
  createdByPersonId: string;
  workflowInstanceId: string;
  taskId: string | null;
}

export async function contextOfRecord(tx: Db, actor: Actor | null, recordId: string): Promise<StepContext> {
  const record = (await tx.featureRecord.findUniqueOrThrow({ where: { id: recordId } })) as RecordRow;
  const resolved = await definitionOfRecord(tx, record);
  return { tx, actor, record, resolved };
}

function dataOf(record: RecordRow): Record<string, unknown> {
  return (record.data as Record<string, unknown>) ?? {};
}

/** Creates (or re-enters) a step instance and does everything that follows from being in it. */
export async function enterStep(
  ctx: StepContext,
  stepKey: string,
  opts: { groupKey?: string | null; branchKey?: string | null; branchPersonId?: string | null } = {},
): Promise<{ id: string } | null> {
  const leaf = ctx.resolved.tree.byKey[stepKey];
  if (!leaf) return null;
  const step = leaf.step;

  const previous = await ctx.tx.featureStepInstance.findFirst({
    where: { recordId: ctx.record.id, stepKey, branchKey: opts.branchKey ?? null },
    orderBy: { sequence: "desc" },
  });
  const assignee = await resolveAssignee(step.assignee, {
    tx: ctx.tx,
    departmentId: ctx.record.departmentId,
    record: {
      id: ctx.record.id,
      ownerPersonId: ctx.record.ownerPersonId,
      createdByPersonId: ctx.record.createdByPersonId,
      data: dataOf(ctx.record),
      parentSubjectType: ctx.record.parentSubjectType,
      parentSubjectId: ctx.record.parentSubjectId,
    },
    branchPersonId: opts.branchPersonId,
  });
  const deadline = await resolveDeadline(ctx, step.deadline);

  const instance = await ctx.tx.featureStepInstance.create({
    data: {
      departmentId: ctx.record.departmentId,
      recordId: ctx.record.id,
      stepKey,
      groupKey: opts.groupKey ?? leaf.groupKey ?? null,
      branchKey: opts.branchKey ?? leaf.branchKey ?? null,
      sequence: (previous?.sequence ?? 0) + 1,
      status: "active",
      assigneeType: (assignee?.type ?? null) as AssigneeType | null,
      assigneeId: assignee?.id ?? null,
      deadlineAt: deadline,
    },
  });

  await backWithTask(ctx, step, instance.id, assignee, deadline);
  await subscribeStepReminders(ctx, step, instance.id, deadline, assignee);
  await scheduleAutos(ctx, stepKey, instance.id, deadline);
  await notifyStep(ctx, step, "onEnter", instance.id, assignee);

  if (step.adapter?.onEnter && getAdapter(step.adapter.onEnter))
    await runAdapter(step.adapter.onEnter, adapterCtx(ctx, instance.id, stepKey), {}, "on_enter");

  await refreshCaches(ctx);
  return { id: instance.id };
}

/** Marks the step done (or rejected) and cleans up everything entering it created. */
export async function exitStep(
  ctx: StepContext,
  stepKey: string,
  opts: { actionKey?: string; branchKey?: string | null; status?: FeatureStepStatus } = {},
): Promise<void> {
  const instance = await ctx.tx.featureStepInstance.findFirst({
    where: { recordId: ctx.record.id, stepKey, branchKey: opts.branchKey ?? null, status: "active" },
    orderBy: { sequence: "desc" },
  });
  if (!instance) return;

  await ctx.tx.featureStepInstance.update({
    where: { id: instance.id },
    data: {
      status: opts.status ?? "done",
      completedAt: new Date(),
      completedByPersonId: ctx.actor?.personId ?? null,
      outcomeActionKey: opts.actionKey ?? null,
    },
  });

  const subject = { subjectType: "feature_step_instance", subjectId: instance.id };
  await cancelBySubject(ctx.tx, subject);
  await cancelByPrefix(ctx.tx, `feature_step_instance:${instance.id}:`);
  if (instance.taskId) await completeTask(ctx.tx, instance.taskId);

  const step = ctx.resolved.tree.byKey[stepKey]?.step;
  if (step) {
    await notifyStep(ctx, step, "onExit", instance.id, null);
    if (step.adapter?.onExit && getAdapter(step.adapter.onExit))
      await runAdapter(step.adapter.onExit, adapterCtx(ctx, instance.id, stepKey), {}, "on_exit");
  }
  await refreshCaches(ctx);
}

/** Enters every branch of a parallel group at once. */
export async function enterParallel(ctx: StepContext, groupKey: string): Promise<void> {
  const parallel = ctx.resolved.tree.parallels.find((p) => p.group.key === groupKey);
  if (!parallel) return;
  const group = parallel.group;

  if (group.branches.mode === "dynamic") {
    // the engine already instantiated one branch state per person when it entered the compound
    // state; following it keeps the instance and the step rows describing the same branches
    const instance = await ctx.tx.workflowInstance.findUnique({
      where: { id: ctx.record.workflowInstanceId },
    });
    const fromInstance = Object.keys(
      (instance?.branchStates as Record<string, unknown> | null) ?? {},
    );
    const persons = fromInstance.length
      ? fromInstance
      : await resolveDynamicPersons(ctx, group.branches.perPerson);
    const first = branchLeaves(ctx.resolved.tree, group.key, "$person")[0];
    for (const personId of persons)
      if (first)
        await enterStep(ctx, first.step.key, {
          groupKey,
          branchKey: personId,
          branchPersonId: personId,
        });
    await refreshCaches(ctx);
    return;
  }

  for (const branch of branchesOf(group)) {
    const first = branchLeaves(ctx.resolved.tree, group.key, branch.key)[0];
    if (first) await enterStep(ctx, first.step.key, { groupKey, branchKey: branch.key });
  }
  await refreshCaches(ctx);
}

/**
 * A branch reached its end: its steps are done and its siblings keep running. The synthetic join
 * calls this with `$group`, which means "the group is over" — whatever is still open there is
 * skipped and its task closed, because the record has already moved on.
 */
export async function completeBranch(
  ctx: StepContext,
  groupKey: string,
  branchKey: string,
): Promise<void> {
  if (branchKey === "$group") {
    const open = await ctx.tx.featureStepInstance.findMany({
      where: { recordId: ctx.record.id, groupKey, status: "active" },
    });
    for (const step of open) {
      await ctx.tx.featureStepInstance.update({
        where: { id: step.id },
        data: { status: "skipped", completedAt: new Date() },
      });
      await cancelBySubject(ctx.tx, {
        subjectType: "feature_step_instance",
        subjectId: step.id,
      });
      if (step.taskId) await completeTask(ctx.tx, step.taskId);
    }
    await refreshCaches(ctx);
    return;
  }

  await ctx.tx.featureStepInstance.updateMany({
    where: { recordId: ctx.record.id, groupKey, branchKey, status: "active" },
    data: { status: "done", completedAt: new Date() },
  });
  await refreshCaches(ctx);
}

/** A branch rejected: the siblings are skipped and their tasks cancelled. */
export async function rejectBranch(
  ctx: StepContext,
  groupKey: string,
  branchKey: string,
): Promise<void> {
  await ctx.tx.featureStepInstance.updateMany({
    where: { recordId: ctx.record.id, groupKey, branchKey, status: "active" },
    data: { status: "rejected", completedAt: new Date() },
  });
  const siblings = await ctx.tx.featureStepInstance.findMany({
    where: { recordId: ctx.record.id, groupKey, status: "active" },
  });
  for (const sibling of siblings) {
    await ctx.tx.featureStepInstance.update({
      where: { id: sibling.id },
      data: { status: "skipped", completedAt: new Date() },
    });
    await cancelBySubject(ctx.tx, {
      subjectType: "feature_step_instance",
      subjectId: sibling.id,
    });
    if (sibling.taskId) await completeTask(ctx.tx, sibling.taskId);
  }
  await refreshCaches(ctx);
}

/** The record reached a terminal state. */
export async function setTerminal(ctx: StepContext, stateKey: string): Promise<void> {
  await ctx.tx.featureStepInstance.updateMany({
    where: { recordId: ctx.record.id, status: "active" },
    data: { status: "skipped", completedAt: new Date() },
  });
  await cancelByPrefix(ctx.tx, `feature_record:${ctx.record.id}:`);
  await ctx.tx.featureRecord.update({
    where: { id: ctx.record.id },
    data: { currentStateKey: stateKey, closedAt: new Date(), deadlineAt: null, branchStatesCache: undefined },
  });
}

/** Copies the workflow instance's state onto the record, where every list can read it. */
export async function refreshCaches(ctx: StepContext): Promise<void> {
  const instance = await ctx.tx.workflowInstance.findUnique({
    where: { id: ctx.record.workflowInstanceId },
  });
  const active = await ctx.tx.featureStepInstance.findMany({
    where: { recordId: ctx.record.id, status: "active" },
    select: { deadlineAt: true },
  });
  const deadlines = active.map((s) => s.deadlineAt).filter((d): d is Date => !!d);
  await ctx.tx.featureRecord.update({
    where: { id: ctx.record.id },
    data: {
      ...(instance ? { currentStateKey: instance.currentState } : {}),
      branchStatesCache: instance?.branchStates ? toJson(instance.branchStates) : undefined,
      deadlineAt: deadlines.length
        ? new Date(Math.min(...deadlines.map((d) => d.getTime())))
        : null,
    },
  });
}

// ---- the pieces entering a step needs ------------------------------------------------------

async function backWithTask(
  ctx: StepContext,
  step: StepDef,
  stepInstanceId: string,
  assignee: Assignee | null,
  deadline: Date | null,
): Promise<void> {
  const template = ctx.resolved.compiled.taskTemplates[step.key];
  if (!template) return;

  // a task-backed feature already has its Task: the step re-points it instead of adding one
  if (!template.createTask) {
    if (ctx.record.taskId && assignee)
      await addAssignees(
        ctx.tx,
        ctx.record.departmentId,
        ctx.record.taskId,
        [{ type: assignee.type, id: assignee.id, role: "responsible" }],
        ctx.record.title,
      );
    return;
  }
  if (!ctx.actor) return;

  const task = await createTask(ctx.tx, ctx.actor, {
    title: `${ctx.resolved.def.name}: ${step.label} — ${ctx.record.title}`,
    kind: "feature_step",
    priority: template.priority,
    context: { subjectType: "feature_record", subjectId: ctx.record.id },
    assignees: assignee ? [{ type: assignee.type, id: assignee.id, role: "responsible" }] : [],
    dueAt: deadline,
    expectedDeliverables: template.expectedDeliverables,
    reminderScheduleKey: template.reminderScheduleKey ?? null,
  });
  await ctx.tx.task.update({ where: { id: task.id }, data: { featureStepInstanceId: stepInstanceId } });
  await ctx.tx.featureStepInstance.update({ where: { id: stepInstanceId }, data: { taskId: task.id } });
}

async function completeTask(tx: Db, taskId: string): Promise<void> {
  await tx.task.update({ where: { id: taskId }, data: { completedAt: new Date() } });
}

async function subscribeStepReminders(
  ctx: StepContext,
  step: StepDef,
  stepInstanceId: string,
  deadline: Date | null,
  assignee: Assignee | null,
): Promise<void> {
  const template = ctx.resolved.compiled.reminderTemplates[step.key];
  if (!template || !deadline) return;
  const persons = assignee?.type === "person" ? [assignee.id] : [];
  const owner = template.audience === "assignee" ? [] : [ctx.record.ownerPersonId];
  await subscribeReminders(ctx.tx, ctx.record.departmentId, {
    subject: { subjectType: "feature_step_instance", subjectId: stepInstanceId },
    scheduleKey: template.scheduleKey,
    deadline: { at: deadline },
    audienceSpec: {
      persons: Array.from(new Set([...(template.audience === "owner" ? [] : persons), ...owner])),
      ...(assignee?.type === "group" ? { groups: [assignee.id] } : {}),
    },
    variables: { record_number: ctx.record.number, record_title: ctx.record.title, step_label: step.label },
  });
}

async function scheduleAutos(
  ctx: StepContext,
  stepKey: string,
  stepInstanceId: string,
  deadline: Date | null,
): Promise<void> {
  const triggers: AutoTrigger[] = ctx.resolved.compiled.autoTriggers[stepKey] ?? [];
  for (const trigger of triggers) {
    const at = await autoFireAt(ctx, trigger, deadline);
    if (!at) continue;
    await enqueue(
      ctx.tx,
      "workflow.auto_transition",
      {
        instanceId: ctx.record.workflowInstanceId,
        transitionKey: trigger.transitionKey,
        departmentId: ctx.record.departmentId,
        expectedState: stepKey,
        branchKey: null,
      },
      {
        kind: "auto_transition",
        startAfter: at,
        singletonKey: `feature_step_instance:${stepInstanceId}:auto:${trigger.actionKey}`,
        departmentId: ctx.record.departmentId,
        idempotencyKey: `feature_step_instance:${stepInstanceId}:auto:${trigger.actionKey}`,
      },
    );
  }
}

async function autoFireAt(
  ctx: StepContext,
  trigger: AutoTrigger,
  deadline: Date | null,
): Promise<Date | null> {
  if (trigger.when === "deadline") return deadline;
  if (trigger.when === "field_datetime") {
    const value = dataOf(ctx.record)[trigger.fieldKey ?? ""];
    return typeof value === "string" || value instanceof Date ? new Date(value as string) : null;
  }
  if (trigger.when === "after_days") {
    const days = trigger.days ?? (await settingDays(ctx.tx, trigger.settingKey));
    return days ? new Date(Date.now() + days * DAY) : null;
  }
  return null;
}

async function settingDays(tx: Db, key?: string): Promise<number | null> {
  if (!key) return null;
  const setting = await tx.systemSetting.findFirst({ where: { key, scope: "global" } });
  const value = setting?.valueJson;
  return typeof value === "number" ? value : null;
}

async function notifyStep(
  ctx: StepContext,
  step: StepDef,
  phase: "onEnter" | "onExit",
  stepInstanceId: string,
  assignee: Assignee | null,
): Promise<void> {
  for (const rule of step.notifications[phase]) {
    const args = audienceArgs(rule.to);
    const recipients =
      args.recipientRule === "feature_assignee" && assignee?.type === "person"
        ? [assignee.id]
        : args.recipientRule === "feature_owner"
          ? [ctx.record.ownerPersonId]
          : args.recipientRule === "feature_creator"
            ? [ctx.record.createdByPersonId]
            : undefined;
    const groups = assignee?.type === "group" && args.recipientRule === "feature_assignee" ? [assignee.id] : undefined;
    if (!recipients?.length && !groups?.length && !args.audienceSpec) continue;

    await notify(ctx.tx, ctx.record.departmentId, {
      ...(recipients ? { recipients } : {}),
      ...(groups ? { audienceSpec: { groups } } : {}),
      ...(args.audienceSpec ? { audienceSpec: args.audienceSpec as never } : {}),
      templateKey: rule.templateKey,
      category: rule.category as never,
      subject: { subjectType: "feature_record", subjectId: ctx.record.id },
      variables: {
        record_number: ctx.record.number,
        record_title: ctx.record.title,
        feature_name: ctx.resolved.def.name,
        step_label: step.label,
      },
      ackRequired: rule.ackRequired,
      declinable: rule.declinable,
      dedupeKey: `feature_step_instance:${stepInstanceId}:${phase}:${rule.templateKey}`,
    });
  }
}

/** The people a dynamic parallel group opens a branch for. */
export async function resolveDynamicPersons(
  ctx: StepContext,
  rule: Parameters<typeof resolveAssignee>[0],
): Promise<string[]> {
  if (rule.type === "role") {
    const { dbAudienceLoader, resolveAudienceIds } = await import("../../people/audience");
    return resolveAudienceIds({ roles: rule.roles }, dbAudienceLoader(ctx.tx, ctx.record.departmentId));
  }
  if (rule.type === "group") {
    const members = await ctx.tx.groupMembership.findMany({
      where: { groupId: rule.groupId, validTo: null },
      select: { personId: true },
    });
    return members.map((m) => m.personId);
  }
  const single = await resolveAssignee(rule, {
    tx: ctx.tx,
    departmentId: ctx.record.departmentId,
    record: {
      id: ctx.record.id,
      ownerPersonId: ctx.record.ownerPersonId,
      createdByPersonId: ctx.record.createdByPersonId,
      data: dataOf(ctx.record),
      parentSubjectType: ctx.record.parentSubjectType,
      parentSubjectId: ctx.record.parentSubjectId,
    },
  });
  return single?.type === "person" ? [single.id] : [];
}

/** Turns an authored deadline rule into a date for this record. */
export async function resolveDeadline(
  ctx: StepContext,
  rule: DeadlineRule | undefined,
): Promise<Date | null> {
  if (!rule) return null;
  if (rule.rule === "fixed") return new Date(rule.at);
  if (rule.rule === "relative") {
    const base =
      rule.from === "record_field"
        ? dateFrom(dataOf(ctx.record)[rule.fieldKey ?? ""])
        : rule.from === "record_created"
          ? new Date()
          : new Date();
    if (!base) return null;
    return new Date(base.getTime() + rule.offsetDays * DAY + (rule.hours ?? 0) * 3_600_000);
  }
  const termId =
    rule.termFrom === "record_field"
      ? String(dataOf(ctx.record)[rule.fieldKey ?? ""] ?? "")
      : await currentTermId(ctx);
  if (!termId) return null;
  return resolveTermAnchor(ctx.tx, termId, {
    periodKind: rule.periodKind as never,
    edge: rule.edge,
    offsetDays: rule.offsetDays,
  });
}

function dateFrom(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value) return new Date(value);
  return null;
}

async function currentTermId(ctx: StepContext): Promise<string | null> {
  const term = await ctx.tx.term.findFirst({
    where: { departmentId: ctx.record.departmentId, status: "current" },
  });
  return term?.id ?? null;
}

function adapterCtx(ctx: StepContext, stepInstanceId: string, stepKey: string) {
  return {
    tx: ctx.tx,
    actor: ctx.actor,
    departmentId: ctx.record.departmentId,
    record: {
      id: ctx.record.id,
      definitionKey: ctx.resolved.key,
      data: dataOf(ctx.record),
      presetKey: ctx.record.presetKey,
    },
    stepInstance: { id: stepInstanceId, stepKey },
  };
}
