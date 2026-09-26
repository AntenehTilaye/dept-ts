import { globalSingleton } from "../../../lib/singleton";
import type { Db } from "../../../lib/db/types";
import type { Actor } from "../../identity/can";

import { relationships as subjectRelationships, isRegistered } from "../../subject-registry";
import { registerGuard, type GuardContext } from "../../workflow/guards";
import { registerEffect, type EffectContext } from "../../workflow/effects";
import type { GuardVerdict } from "../../workflow/machine";
import { registerBuiltinAdapters } from "../adapters/builtin";
import { getAdapter, runAdapter } from "../adapters/registry";
import type { ActorRuleType as ActorRule } from "../schema";
import {
  completeBranch,
  contextOfRecord,
  enterParallel,
  enterStep,
  exitStep,
  rejectBranch,
  setTerminal,
  type StepContext,
} from "./steps";

// The bridge between the workflow engine and the feature runtime. The compiled transitions carry
// `enterStep`, `exitStep`, `enterParallel`, `completeBranch`, `rejectBranch` and `setTerminal`
// effects; these handlers are what they mean. The guards answer the two questions every feature
// transition asks: may this actor act, and is the step finished.

const state = globalSingleton("feature-runtime-effects", () => ({ installed: false }));

export function installFeatureRuntime(): void {
  if (state.installed) return;
  state.installed = true;
  registerBuiltinAdapters();

  registerEffect("enterStep", async (args, ctx) => {
    const step = await featureContext(ctx);
    if (!step) return;
    await enterStep(step, String(args.stepKey), {
      groupKey: (args.groupKey as string) ?? null,
      branchKey: (args.branchKey as string) ?? ctx.input.branchKey ?? null,
    });
  });

  registerEffect("exitStep", async (args, ctx) => {
    const step = await featureContext(ctx);
    if (!step) return;
    await exitStep(step, String(args.stepKey), {
      actionKey: args.actionKey ? String(args.actionKey) : undefined,
      branchKey: (args.branchKey as string) ?? ctx.input.branchKey ?? null,
    });
  });

  registerEffect("enterParallel", async (args, ctx) => {
    const step = await featureContext(ctx);
    if (step) await enterParallel(step, String(args.groupKey));
  });

  registerEffect("completeBranch", async (args, ctx) => {
    const step = await featureContext(ctx);
    if (step)
      await completeBranch(
        step,
        String(args.groupKey),
        String(args.branchKey ?? ctx.input.branchKey ?? ""),
      );
  });

  registerEffect("rejectBranch", async (args, ctx) => {
    const step = await featureContext(ctx);
    if (step)
      await rejectBranch(
        step,
        String(args.groupKey),
        String(args.branchKey ?? ctx.input.branchKey ?? ""),
      );
  });

  registerEffect("setTerminal", async (args, ctx) => {
    const step = await featureContext(ctx);
    if (step) await setTerminal(step, String(args.stateKey));
  });

  registerGuard("feature.actorAllowed", (ctx) => actorAllowed(ctx));
  registerGuard("feature.stepComplete", (ctx) => stepComplete(ctx));
  registerGuard("feature.parentActive", (ctx) => parentActive(ctx));
  registerGuard("feature.deadlineNotPassed", (ctx) => deadlineNotPassed(ctx));
}

async function featureContext(ctx: EffectContext): Promise<StepContext | null> {
  if (ctx.instance.subjectType !== "feature_record") return null;
  return contextOfRecord(ctx.tx, ctx.actor, ctx.instance.subjectId);
}

// ---- guards ---------------------------------------------------------------------------------

/** The actor satisfies one of the transition's actor rules. */
export async function actorAllowed(ctx: GuardContext): Promise<GuardVerdict> {
  const rules = ctx.transition.actorRules as ActorRule[];
  if (!rules.length) return true;
  if (ctx.transition.system) return true;
  const actor = ctx.actor;
  if (!actor) return { ok: false, reason: "no actor" };
  if (actor.isAdmin) return true;

  const record = await ctx.tx.featureRecord.findUnique({
    where: { id: ctx.instance.subjectId },
  });
  if (!record) return { ok: false, reason: "the record is gone" };

  for (const rule of rules)
    if (await matches(ctx.tx, rule, actor, record, ctx.input.branchKey)) return true;
  return { ok: false, reason: "you are not one of the people this action is for" };
}

type RecordRowLite = {
  id: string;
  departmentId: string;
  ownerPersonId: string;
  createdByPersonId: string;
  data: unknown;
  parentSubjectType: string | null;
  parentSubjectId: string | null;
};

async function matches(
  tx: Db,
  rule: ActorRule,
  actor: Actor,
  record: RecordRowLite,
  branchKey?: string,
): Promise<boolean> {
  switch (rule.type) {
    case "owner":
      return actor.personId === record.ownerPersonId;
    case "creator":
      return actor.personId === record.createdByPersonId;
    case "assignee":
      return isAssignee(tx, record.id, actor, branchKey);
    case "person":
      return actor.personId === rule.personId;
    case "group":
      return memberOfGroup(tx, rule.groupId, actor.personId);
    case "role":
      // membership roles reach the actor as RoleGrant rows too (P2 derives them), so one query
      // answers both "is a department head" and "chairs this committee"
      return hasRoleGrant(tx, actor, rule.roles, rule.scope === "parent" ? record.parentSubjectId : null);
    case "record_field": {
      const value = ((record.data as Record<string, unknown>) ?? {})[rule.fieldKey];
      return typeof value === "string" && (value === actor.personId || memberOfGroup(tx, value, actor.personId));
    }
    case "relationship": {
      const parent =
        record.parentSubjectType && record.parentSubjectId
          ? { subjectType: record.parentSubjectType, subjectId: record.parentSubjectId }
          : null;
      if (rule.rel === "requester") return actor.personId === record.createdByPersonId;
      if (!parent || !isRegistered(parent.subjectType) || !actor.personId) return false;
      const rels = await subjectRelationships(tx, parent, actor.personId);
      return rels.includes(rule.rel.replace(/^parent_/, "") as never) || rels.includes(rule.rel as never);
    }
    case "permission":
      // an explicit permission key is checked by the engine before the guards run
      return true;
    case "system":
      return false;
  }
}

async function isAssignee(
  tx: Db,
  recordId: string,
  actor: Actor,
  branchKey?: string,
): Promise<boolean> {
  if (!actor.personId) return false;
  const steps = await tx.featureStepInstance.findMany({
    where: { recordId, status: "active", ...(branchKey ? { branchKey } : {}) },
  });
  for (const step of steps) {
    if (step.assigneeType === "person" && step.assigneeId === actor.personId) return true;
    if (step.assigneeType === "group" && step.assigneeId) {
      const member = await tx.groupMembership.findFirst({
        where: { groupId: step.assigneeId, personId: actor.personId, validTo: null },
      });
      if (member) return true;
    }
  }
  return false;
}

async function hasRoleGrant(
  tx: Db,
  actor: Actor,
  roles: string[],
  scopeId: string | null,
): Promise<boolean> {
  const now = new Date();
  const grant = await tx.roleGrant.findFirst({
    where: {
      userId: actor.userId,
      role: { key: { in: roles } },
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      ...(scopeId ? { scopeId } : {}),
    },
    select: { id: true },
  });
  return !!grant;
}

async function memberOfGroup(tx: Db, groupId: string, personId: string | null): Promise<boolean> {
  if (!personId) return false;
  const member = await tx.groupMembership.findFirst({
    where: { groupId, personId, validTo: null },
  });
  return !!member;
}

/** Required answers, attachments and comment of the step the transition leaves. */
export async function stepComplete(ctx: GuardContext): Promise<GuardVerdict> {
  const t = ctx.transition;
  if (t.requiredComment && !ctx.input.comment?.trim())
    return { ok: false, reason: "a comment is required" };

  const step = await ctx.tx.featureStepInstance.findFirst({
    where: {
      recordId: ctx.instance.subjectId,
      stepKey: t.from,
      status: "active",
      ...(ctx.input.branchKey ? { branchKey: ctx.input.branchKey } : {}),
    },
    orderBy: { sequence: "desc" },
  });

  if (t.requiredFields.length) {
    const answers = { ...(ctx.input.fields ?? {}) };
    if (step?.submissionId) {
      const submission = await ctx.tx.submission.findUnique({
        where: { id: step.submissionId },
        include: { answers: true },
      });
      for (const answer of submission?.answers ?? [])
        answers[answer.questionStableKey] = answer.valueJson;
    }
    const record = await ctx.tx.featureRecord.findUnique({ where: { id: ctx.instance.subjectId } });
    const data = (record?.data as Record<string, unknown>) ?? {};
    const missing = t.requiredFields.filter(
      (key) => isEmpty(answers[key]) && isEmpty(data[key]),
    );
    if (missing.length) return { ok: false, reason: `missing answers: ${missing.join(", ")}` };
  }

  if (t.requiredAttachments.length) {
    // whether the paper is there is a fact about the slot, not about this actor's reading
    // rights, and a slot may be filled on the step or on the record — both are the same slot
    const links = await ctx.tx.documentLink.findMany({
      where: {
        slotKey: { in: t.requiredAttachments },
        OR: [
          { subjectType: "feature_record" as const, subjectId: ctx.instance.subjectId },
          ...(step
            ? [{ subjectType: "feature_step_instance" as const, subjectId: step.id }]
            : []),
        ],
      },
      select: { slotKey: true },
    });
    const filled = new Set(links.map((link) => link.slotKey));
    const missing = t.requiredAttachments.filter((slotKey) => !filled.has(slotKey));
    if (missing.length)
      return { ok: false, reason: `"${missing[0]}" has not been uploaded yet` };
  }
  return true;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
}

/** A child record cannot move while its parent is closed. */
export async function parentActive(ctx: GuardContext): Promise<GuardVerdict> {
  const record = await ctx.tx.featureRecord.findUnique({ where: { id: ctx.instance.subjectId } });
  if (!record?.parentSubjectId || record.parentSubjectType !== "feature_record") return true;
  const parent = await ctx.tx.featureRecord.findUnique({ where: { id: record.parentSubjectId } });
  return parent && !parent.closedAt ? true : { ok: false, reason: "the parent record is closed" };
}

export async function deadlineNotPassed(ctx: GuardContext): Promise<GuardVerdict> {
  const step = await ctx.tx.featureStepInstance.findFirst({
    where: { recordId: ctx.instance.subjectId, stepKey: ctx.transition.from, status: "active" },
    orderBy: { sequence: "desc" },
  });
  if (!step?.deadlineAt) return true;
  return step.deadlineAt.getTime() >= Date.now()
    ? true
    : { ok: false, reason: "the deadline for this step has passed" };
}

/** Runs an adapter guard named by a definition (the compiler appends them after the built-ins). */
export async function adapterGuard(key: string, ctx: GuardContext): Promise<GuardVerdict> {
  if (!getAdapter(key)) return { ok: false, reason: `unknown adapter "${key}"` };
  return runAdapter<GuardVerdict>(
    key,
    {
      tx: ctx.tx,
      actor: ctx.actor,
      departmentId: ctx.instance.departmentId,
      transition: {
        key: ctx.transition.key,
        action: ctx.transition.action,
        from: ctx.transition.from,
        to: ctx.transition.to,
      },
    },
    {},
    "guard",
  );
}
