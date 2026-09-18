import type { NotificationCategory } from "@/generated/prisma/enums";
import { globalSingleton } from "../../lib/singleton";
import { AudienceSpecSchema, type AudienceSpec } from "../people/audience";
import { registerEffect, type EffectContext } from "../workflow/effects";
import { enqueue } from "./enqueue";
import { cancelByPrefix } from "./ledger";
import { notify } from "./notify";
import { DeadlineSpec } from "./offsets";
import { cancelBySubject, subscribeReminders } from "./reminders";

// The scheduler-backed workflow effects, replacing the P4 recorders:
//   notify                 { templateKey, category, audienceSpec | recipients | recipientRule, ackRequired, declinable, variables, dedupe }
//   subscribeReminders     { scheduleKey, deadline: DeadlineSpec, audienceSpec, variables }
//   cancelReminders        { scheduleKey? }
//   cancelScheduled        { prefix? }   (defaults to every job of the subject)
//   scheduleAutoTransition { transitionKey, afterHours | at, expectedState? }

const state = globalSingleton("scheduler-effects", () => ({ installed: false }));

type Args = Record<string, unknown>;

function subjectKey(ctx: EffectContext): string {
  return `${ctx.instance.subjectType}:${ctx.instance.subjectId}`;
}

function objectArg(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v ? (v as Record<string, unknown>) : {};
}

async function recipientsOf(
  ctx: EffectContext,
  args: Args,
): Promise<{ recipients?: string[]; audienceSpec?: AudienceSpec }> {
  if (Array.isArray(args.recipients)) return { recipients: args.recipients.map(String) };
  if (args.audienceSpec) return { audienceSpec: AudienceSpecSchema.parse(args.audienceSpec) };
  const rule = typeof args.recipientRule === "string" ? args.recipientRule : "actor";
  if (rule === "actor") return { recipients: ctx.actor?.personId ? [ctx.actor.personId] : [] };
  if (rule === "department_head") return { audienceSpec: { roles: ["department_head"] } };
  return { recipients: [] };
}

export function installSchedulerEffects(): void {
  if (state.installed) return;
  state.installed = true;

  registerEffect("notify", async (args, ctx) => {
    const target = await recipientsOf(ctx, args);
    if (!target.recipients?.length && !target.audienceSpec) return;
    await notify(ctx.tx, ctx.instance.departmentId, {
      ...target,
      templateKey: typeof args.templateKey === "string" ? args.templateKey : undefined,
      title: typeof args.title === "string" ? args.title : undefined,
      body: typeof args.body === "string" ? args.body : undefined,
      variables: {
        ...objectArg(args.variables),
        ...(ctx.input.fields ?? {}),
        comment: ctx.input.comment ?? "",
        state: ctx.step.toState,
      },
      category: (typeof args.category === "string"
        ? args.category
        : "workflow") as NotificationCategory,
      subject: { subjectType: ctx.instance.subjectType, subjectId: ctx.instance.subjectId },
      actionUrl: typeof args.actionUrl === "string" ? args.actionUrl : null,
      ackRequired: args.ackRequired === true,
      declinable: args.declinable === true,
      dedupeKey:
        typeof args.dedupe === "string"
          ? args.dedupe
          : `${subjectKey(ctx)}:${ctx.step.transitionKey}:${Date.now()}`,
      confirmMassSend: args.confirmMassSend === true,
    });
  });

  registerEffect("subscribeReminders", async (args, ctx) => {
    if (!args.scheduleKey || !args.deadline)
      throw new Error("subscribeReminders: scheduleKey and deadline are required");
    await subscribeReminders(ctx.tx, ctx.instance.departmentId, {
      subject: { subjectType: ctx.instance.subjectType, subjectId: ctx.instance.subjectId },
      scheduleKey: String(args.scheduleKey),
      deadline: DeadlineSpec.parse(args.deadline),
      audienceSpec: AudienceSpecSchema.parse(
        args.audienceSpec ?? { persons: ctx.actor?.personId ? [ctx.actor.personId] : [] },
      ),
      variables: objectArg(args.variables),
    });
  });

  registerEffect("cancelReminders", async (args, ctx) => {
    const subject = { subjectType: ctx.instance.subjectType, subjectId: ctx.instance.subjectId };
    await cancelBySubject(
      ctx.tx,
      subject,
      typeof args.scheduleKey === "string" ? args.scheduleKey : undefined,
    );
  });

  registerEffect("cancelScheduled", async (args, ctx) => {
    await cancelByPrefix(
      ctx.tx,
      typeof args.prefix === "string" ? args.prefix : `${subjectKey(ctx)}:`,
    );
    await cancelByPrefix(ctx.tx, `wf:${ctx.instance.id}:`);
  });

  registerEffect("scheduleAutoTransition", async (args, ctx) => {
    const transitionKey = String(args.transitionKey ?? "");
    if (!transitionKey) throw new Error("scheduleAutoTransition: transitionKey is required");
    const runAt =
      typeof args.at === "string"
        ? new Date(args.at)
        : new Date(Date.now() + Number(args.afterHours ?? 0) * 3_600_000);
    const expectedState =
      typeof args.expectedState === "string" ? args.expectedState : ctx.step.toState;
    const key = `wf:${ctx.instance.id}:${transitionKey}:${runAt.toISOString()}`;
    const data = {
      instanceId: ctx.instance.id,
      transitionKey,
      expectedState,
      departmentId: ctx.instance.departmentId,
      idempotencyKey: key,
    };
    await enqueue(ctx.tx, "workflow.auto_transition", data, {
      kind: "auto_transition",
      idempotencyKey: key,
      singletonKey: key,
      startAfter: runAt,
      departmentId: ctx.instance.departmentId,
      subjectType: ctx.instance.subjectType,
      subjectId: ctx.instance.subjectId,
    });
  });
}
