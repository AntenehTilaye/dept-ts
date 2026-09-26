import type { Db } from "../../../lib/db/types";
import type { Actor } from "../../identity/can";
import { saveDraft, submit, type AnswerMap } from "../../forms/submissions";
import { applyIn, availableActions as workflowActions, type ApplyResult } from "../../workflow/engine";
import { contextOfRecord, resolveDynamicPersons, type StepContext } from "./steps";

// The single path into a feature's lifecycle. Everything a page or a job wants to do to a record
// goes through `act`: it stores the step's answers, then asks the workflow engine to apply the
// transition. The engine runs the guards and the compiled effects, which is where the record
// actually moves — nothing here writes state of its own.

export class ActError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActError";
  }
}

export interface ActInput {
  answers?: AnswerMap;
  comment?: string;
  branchKey?: string | null;
  attachments?: string[];
}

export async function act(
  tx: Db,
  recordId: string,
  stepKey: string,
  actionKey: string,
  actor: Actor,
  input: ActInput = {},
): Promise<ApplyResult> {
  const ctx = await contextOfRecord(tx, actor, recordId);
  const step = ctx.resolved.tree.byKey[stepKey];
  if (!step) throw new ActError(`"${ctx.resolved.key}" has no step "${stepKey}"`);
  const action = step.step.actions.find((a) => a.key === actionKey);
  if (!action) throw new ActError(`"${stepKey}" has no action "${actionKey}"`);

  if (input.answers && Object.keys(input.answers).length)
    await saveAnswers(ctx, stepKey, input.branchKey ?? null, input.answers, true);

  // a dynamic group's branches only exist once its people are known, and the engine instantiates
  // them as it enters the compound state — so they are resolved here, before the transition
  const personIds = await dynamicPersonsFor(ctx, `${stepKey}.${actionKey}`);

  return applyIn(tx, ctx.record.workflowInstanceId, `${stepKey}.${actionKey}`, actor, {
    ...(personIds ? { personIds } : {}),
    comment: input.comment,
    // an action requires an answer, not an answer sent with it: what the step already holds
    // counts, and so do the header answers the record was created with
    fields: {
      ...(await savedAnswers(tx, ctx, stepKey, input.branchKey ?? null)),
      ...((ctx.record.data as Record<string, unknown>) ?? {}),
      ...(input.answers ?? {}),
    },
    branchKey: input.branchKey ?? undefined,
    attachments: await satisfiedSlots(tx, ctx, stepKey, input.branchKey ?? null, input.attachments),
  });
}

/** What this step's form already holds, so a required answer saved earlier still counts. */
async function savedAnswers(
  tx: Db,
  ctx: StepContext,
  stepKey: string,
  branchKey: string | null,
): Promise<Record<string, unknown>> {
  const instance = await tx.featureStepInstance.findFirst({
    where: { recordId: ctx.record.id, stepKey, branchKey, status: "active" },
    orderBy: { sequence: "desc" },
    select: { submissionId: true },
  });
  if (!instance?.submissionId) return {};
  const rows = await tx.answer.findMany({
    where: { submissionId: instance.submissionId },
    select: { questionStableKey: true, valueJson: true },
  });
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.questionStableKey] ??= row.valueJson;
  return out;
}

/**
 * Which attachment slots of this step actually hold a paper. An action that requires one is
 * asking about the world, not about what the caller claims — so the answer is the document links
 * on the step and on the record, and a caller may only add to it.
 */
async function satisfiedSlots(
  tx: Db,
  ctx: StepContext,
  stepKey: string,
  branchKey: string | null,
  claimed: string[] | undefined,
): Promise<string[]> {
  const step = ctx.resolved.tree.byKey[stepKey];
  const slots = step?.step.attachments ?? [];
  if (!slots.length) return claimed ?? [];
  const instance = await tx.featureStepInstance.findFirst({
    where: { recordId: ctx.record.id, stepKey, branchKey, status: "active" },
    orderBy: { sequence: "desc" },
    select: { id: true },
  });
  const links = await tx.documentLink.findMany({
    where: {
      slotKey: { in: slots.map((slot) => slot.slotKey) },
      OR: [
        { subjectType: "feature_record", subjectId: ctx.record.id },
        ...(instance
          ? [{ subjectType: "feature_step_instance" as const, subjectId: instance.id }]
          : []),
      ],
    },
    select: { slotKey: true },
  });
  return Array.from(new Set([...(claimed ?? []), ...links.map((link) => link.slotKey)]));
}

async function dynamicPersonsFor(
  ctx: StepContext,
  transitionKey: string,
): Promise<string[] | null> {
  const transition = ctx.resolved.compiled.workflow.transitions.find((t) => t.key === transitionKey);
  const target = transition
    ? ctx.resolved.compiled.workflow.states.find((s) => s.key === transition.to)
    : undefined;
  if (!target?.compound?.dynamic) return null;
  const group = ctx.resolved.tree.parallels.find((p) => p.group.key === target.key)?.group;
  if (!group || group.branches.mode !== "dynamic") return null;
  return resolveDynamicPersons(ctx, group.branches.perPerson);
}

/** Saves the step's answers without moving the record. */
export async function saveStepDraft(
  tx: Db,
  recordId: string,
  stepKey: string,
  actor: Actor,
  answers: AnswerMap,
  branchKey?: string | null,
): Promise<{ submissionId: string | null }> {
  const ctx = await contextOfRecord(tx, actor, recordId);
  const id = await saveAnswers(ctx, stepKey, branchKey ?? null, answers, false);
  return { submissionId: id };
}

/**
 * One Submission per step instance, pinned to the form version the definition compiled.
 * A draft is upgraded to a submitted one when the step is left, so the answers of a revision
 * loop stay separable by step instance.
 */
async function saveAnswers(
  ctx: StepContext,
  stepKey: string,
  branchKey: string | null,
  answers: AnswerMap,
  final: boolean,
): Promise<string | null> {
  const form = ctx.resolved.compiled.forms[stepKey];
  if (!form) return null;
  const formKey = form.reuseFormKey ?? form.key;

  const instance = await ctx.tx.featureStepInstance.findFirst({
    where: { recordId: ctx.record.id, stepKey, branchKey, status: "active" },
    orderBy: { sequence: "desc" },
  });
  if (!instance) return null;

  const subject = { subjectType: "feature_step_instance", subjectId: instance.id };
  const submitCtx = {
    subject,
    stepKey,
    respondentPersonId: ctx.actor?.personId ?? null,
  };

  const saved = final
    ? await submit(ctx.tx, ctx.record.departmentId, formKey, answers, submitCtx, instance.submissionId ?? undefined)
    : await saveDraft(ctx.tx, ctx.record.departmentId, formKey, answers, submitCtx, instance.submissionId ?? undefined);

  if (!instance.submissionId)
    await ctx.tx.featureStepInstance.update({
      where: { id: instance.id },
      data: { submissionId: saved.id },
    });
  return saved.id;
}

export interface AvailableAction {
  key: string;
  label: string;
  stepKey: string;
  branchKey?: string;
  kind: string;
  requiresComment: boolean;
  confirm?: { title: string; message: string };
  allowed: boolean;
  /** Allowed to act on this step at all — the inputs may still be missing. */
  actorAllowed: boolean;
  reason?: string;
}

/** What this actor may do right now, with the reason when they may not. */
export async function availableActions(
  tx: Db,
  recordId: string,
  actor: Actor | null,
): Promise<AvailableAction[]> {
  const ctx = await contextOfRecord(tx, actor, recordId);
  const engineActions = await workflowActions(tx, ctx.record.workflowInstanceId, actor);
  const out: AvailableAction[] = [];

  for (const available of engineActions) {
    const [stepKey = "", actionKey = ""] = available.transitionKey.split(".");
    const step = ctx.resolved.tree.byKey[stepKey];
    const action = step?.step.actions.find((a) => a.key === actionKey);
    if (!step || !action) continue;
    out.push({
      key: action.key,
      label: action.label,
      stepKey,
      ...(available.branchKey ? { branchKey: available.branchKey } : {}),
      kind: action.kind,
      requiresComment: action.requiredComment,
      ...(action.confirm ? { confirm: action.confirm } : {}),
      allowed: available.enabled,
      actorAllowed: available.actorAllowed,
      ...(available.disabledReason ? { reason: available.disabledReason } : {}),
    });
  }
  return out;
}
