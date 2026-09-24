"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { actorOf } from "@/lib/auth/require";
import { act, createRecord, saveStepDraft } from "@/platform/feature";

// The generic runtime's server actions. There is exactly one of each for every feature in the
// faculty: the feature key is an argument, not a file, which is the whole point of the builder.

const Answers = z.record(z.string(), z.unknown());

export const createRecordAction = safeAction(
  z.object({
    featureKey: z.string().min(1),
    presetKey: z.string().min(1).optional(),
    data: Answers.default({}),
    parentRef: z
      .object({ subjectType: z.string().min(1), subjectId: z.string().min(1) })
      .optional(),
  }),
  async ({ input, ctx, db }) => {
    const record = await createRecord(db, ctx.departmentId, actorOf(ctx), input.featureKey, {
      data: input.data,
      presetKey: input.presetKey ?? null,
      parentRef: input.parentRef ?? null,
    });
    revalidatePath(`/d/${ctx.deptSlug}/f/${input.featureKey}`);
    return record;
  },
);

export const actOnStepAction = safeAction(
  z.object({
    featureKey: z.string().min(1),
    recordId: z.string().min(1),
    stepKey: z.string().min(1),
    actionKey: z.string().min(1),
    branchKey: z.string().min(1).optional(),
    comment: z.string().trim().max(4000).optional(),
    answers: Answers.optional(),
    attachments: z.array(z.string()).optional(),
  }),
  async ({ input, ctx, db }) => {
    const result = await act(db, input.recordId, input.stepKey, input.actionKey, actorOf(ctx), {
      comment: input.comment,
      answers: input.answers,
      branchKey: input.branchKey ?? null,
      attachments: input.attachments,
    });
    const base = `/d/${ctx.deptSlug}/f/${input.featureKey}`;
    revalidatePath(base);
    revalidatePath(`${base}/${input.recordId}`);
    return {
      state: result.instance.currentState,
      terminal: result.terminal,
      applied: result.applied.map((a) => a.transitionKey),
    };
  },
);

export const saveStepDraftAction = safeAction(
  z.object({
    featureKey: z.string().min(1),
    recordId: z.string().min(1),
    stepKey: z.string().min(1),
    branchKey: z.string().min(1).optional(),
    answers: Answers,
  }),
  async ({ input, ctx, db }) => {
    const saved = await saveStepDraft(
      db,
      input.recordId,
      input.stepKey,
      actorOf(ctx),
      input.answers,
      input.branchKey ?? null,
    );
    return saved;
  },
);
