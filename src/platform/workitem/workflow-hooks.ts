import { globalSingleton } from "../../lib/singleton";
import type { Db } from "../../lib/db/types";
import { subscribe } from "../audit/outbox";
import { getOrCreateThread, post } from "../thread/service";
import type { Actor } from "../identity/can";
import { notify } from "../scheduler/notify";
import { registerOverdueProvider } from "../scheduler/providers";
import { registerRecipientRule } from "../scheduler/effects";
import {
  allowSetField,
  registerEffect,
  registerHandler,
  type EffectContext,
} from "../workflow/effects";
import { registerGuard } from "../workflow/guards";
import { instanceOf } from "../workflow/engine";
import { TASK_DEFINITION_KEY } from "../workflow/definitions/task";
import { assigneePersonIds } from "./assignments";
import { createTask, deliverableStatus, transition, type CreateTaskInput } from "./service";
import { listTasks } from "./queries";

// Everything the work item contributes to the kernel: the deliverable guard, the real
// `createTask` effect, the `completedAt` setter, the notification subscribers that turn an
// acknowledgement into a start (and a decline into a comment) and the overdue sweep provider.

const state = globalSingleton("workitem-hooks", () => ({ installed: false }));

function argString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

export function installWorkItemHooks(): void {
  if (state.installed) return;
  state.installed = true;

  // --- guard -------------------------------------------------------------------------
  registerGuard("task.requiredDeliverablesLinked", async (ctx) => {
    const slots = await deliverableStatus(ctx.tx, ctx.instance.subjectId);
    const missing = slots.filter((s) => s.required && !s.satisfied).map((s) => s.label || s.key);
    return missing.length
      ? { ok: false as const, reason: `Missing required deliverable(s): ${missing.join(", ")}` }
      : true;
  });

  // --- notify recipient rules --------------------------------------------------------
  registerRecipientRule("task_assignees", async (ctx) =>
    ctx.instance.subjectType === "task" ? assigneePersonIds(ctx.tx, ctx.instance.subjectId) : [],
  );
  registerRecipientRule("task_creator", async (ctx) => {
    if (ctx.instance.subjectType !== "task") return [];
    const task = await ctx.tx.task.findUnique({
      where: { id: ctx.instance.subjectId },
      select: { createdBy: true },
    });
    if (!task) return [];
    const person = await ctx.tx.person.findFirst({
      where: { userId: task.createdBy },
      select: { id: true },
    });
    return person ? [person.id] : [];
  });

  // --- derived caches ----------------------------------------------------------------
  allowSetField("task", "completedAt", { model: "task", column: "completedAt" });
  allowSetField("case", "resolvedAt", { model: "case", column: "resolvedAt", idField: "taskId" });

  // --- effects -----------------------------------------------------------------------
  // createTask: a transition spawns follow-up work (meeting action items, CQI actions, ...).
  registerEffect("createTask", async (args, ctx) => {
    const actor: Actor = ctx.actor ?? {
      userId: "system",
      personId: null,
      departmentId: ctx.instance.departmentId,
      isAdmin: true,
    };
    const spec: CreateTaskInput = {
      title: argString(args, "title") ?? `Follow-up on ${ctx.instance.subjectId}`,
      description: argString(args, "description") ?? null,
      kind: (argString(args, "kind") ?? "general") as CreateTaskInput["kind"],
      context: { subjectType: ctx.instance.subjectType, subjectId: ctx.instance.subjectId },
      assignees: Array.isArray(args.assignees)
        ? (args.assignees as CreateTaskInput["assignees"])
        : [],
      dueAt: typeof args.dueAt === "string" ? new Date(args.dueAt) : null,
      expectedDeliverables: Array.isArray(args.expectedDeliverables)
        ? (args.expectedDeliverables as CreateTaskInput["expectedDeliverables"])
        : [],
    };
    await createTask(ctx.tx, { ...actor, departmentId: ctx.instance.departmentId }, spec);
  });

  // the derived caches a task transition may write
  registerHandler("task.setCompletedAt", async (ctx: EffectContext) => {
    await ctx.tx.task.update({
      where: { id: ctx.instance.subjectId },
      data: { completedAt: new Date(), progressPercent: 100 },
    });
  });

  // --- subscribers -------------------------------------------------------------------
  // acknowledging the assignment starts the task
  subscribe("notification.acknowledged", "workitem.start_on_ack", async (e, tx) => {
    if (e.aggregateType !== "task" || !e.departmentId) return;
    const p = e.payloadJson as { personId?: string } | null;
    if (!p?.personId) return;
    const instance = await instanceOf(
      tx,
      { subjectType: "task", subjectId: e.aggregateId },
      TASK_DEFINITION_KEY,
    );
    if (!instance || instance.currentState !== "assigned") return;
    // the acknowledging assignee is the actor, so the transition's actor rules apply normally
    const person = await tx.person.findUnique({
      where: { id: p.personId },
      select: { userId: true },
    });
    if (!person?.userId) return;
    await transition(
      tx,
      {
        userId: person.userId,
        personId: p.personId,
        departmentId: e.departmentId,
        isAdmin: false,
      },
      e.aggregateId,
      "start",
    );
  });

  // declining posts a comment on the task thread and tells the creator
  subscribe("notification.declined", "workitem.decline", async (e, tx) => {
    const p = e.payloadJson as { personId?: string; reason?: string } | null;
    if (e.aggregateType !== "task" || !p?.personId || !e.departmentId) return;
    const task = await tx.task.findUnique({ where: { id: e.aggregateId } });
    if (!task) return;
    const person = await tx.person.findUnique({
      where: { id: p.personId },
      select: { fullName: true },
    });
    const thread = await getOrCreateThread(
      tx,
      e.departmentId,
      { subjectType: "task", subjectId: e.aggregateId },
      "comments",
      task.createdBy,
    );
    await post(
      tx,
      { userId: task.createdBy, personId: p.personId, departmentId: e.departmentId, isAdmin: true },
      {
        threadId: thread.id,
        body: `${person?.fullName ?? "An assignee"} declined this assignment: ${p.reason ?? "no reason given"}`,
      },
    );
    const creatorPerson = await tx.person.findFirst({
      where: { userId: task.createdBy },
      select: { id: true },
    });
    if (creatorPerson)
      await notify(tx, e.departmentId, {
        recipients: [creatorPerson.id],
        templateKey: "task_declined",
        category: "assignment",
        subject: { subjectType: "task", subjectId: e.aggregateId },
        dedupeKey: `task:${e.aggregateId}:declined:${p.personId}`,
        variables: {
          title: task.title,
          assignee_name: person?.fullName ?? "An assignee",
          comment: p.reason ?? "",
        },
      });
  });

  // --- overdue sweep -----------------------------------------------------------------
  registerOverdueProvider("task.overdue", async ({ tx, departmentId, now }) => {
    const overdue = await listTasks(tx, departmentId, { overdue: true, open: true }, now);
    let n = 0;
    for (const t of overdue) {
      const persons = await assigneePersonIds(tx, t.id);
      if (!persons.length) continue;
      const days = Math.floor((now.getTime() - (t.dueAt?.getTime() ?? 0)) / 86_400_000);
      const result = await notify(tx, departmentId, {
        recipients: persons,
        templateKey: "deadline_overdue",
        category: "deadline_missed",
        subject: { subjectType: "task", subjectId: t.id },
        dedupeKey: `task:${t.id}:overdue:${now.toISOString().slice(0, 10)}`,
        variables: {
          title: t.title,
          deadline: t.dueAt?.toISOString().slice(0, 10) ?? "",
          days,
        },
      });
      n += result.created.length;
    }
    return n;
  });
}

/** Registers the work item's subject types and hooks (called by bootstrap). */
export async function taskThread(db: Db, taskId: string, openedBy: string) {
  return getOrCreateThread(
    db,
    (await db.task.findUniqueOrThrow({ where: { id: taskId } })).departmentId,
    { subjectType: "task", subjectId: taskId },
    "comments",
    openedBy,
  );
}
