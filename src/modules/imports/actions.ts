"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { toJson } from "@/lib/db/json";
import { actorOf } from "@/lib/auth/require";
import { commitAuthority, fixRow, skipRow, validateBatch } from "@/platform/import";
import { can } from "@/platform/identity/can";
import { dbPolicyStore } from "@/platform/identity/policy-store";
import type { Db } from "@/lib/db/types";
import type { DeptCtx } from "@/lib/auth/require";

// What the import surfaces do. Each one is small on purpose: the pipeline holds the behaviour,
// and these only carry a person's decision into it.

/**
 * Whether this person may work on this batch. It is the same question the commit guard asks, so it
 * has the same answer: a kind that says who owns its rows decides, and everything else is whoever
 * manages imports. Working on a batch you may not commit would be busywork with a locked door at
 * the end of it.
 */
async function assertMayEdit(db: Db, ctx: DeptCtx, batchId: string): Promise<void> {
  const actor = actorOf(ctx);
  if (actor.isAdmin) return;
  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    select: { kind: true, contextType: true, contextId: true },
  });
  const authority = batch ? commitAuthority(batch.kind) : undefined;
  if (authority) {
    const verdict = await authority({
      tx: db,
      actor,
      context:
        batch?.contextType && batch.contextId
          ? { subjectType: batch.contextType, subjectId: batch.contextId }
          : null,
    });
    if (verdict === true) return;
    throw new Error((verdict as { reason: string }).reason);
  }
  const decision = await can(dbPolicyStore, actor, "import.manage", undefined, { verb: "manage" });
  if (!decision.allowed) throw new Error(decision.reason);
}

export const fixImportRowAction = safeAction(
  z.object({
    batchId: z.string().min(1),
    rowNo: z.number().int().min(1),
    patch: z.record(z.string(), z.unknown()),
  }),
  async ({ input, ctx, db }) => {
    await assertMayEdit(db, ctx, input.batchId);
    const summary = await fixRow(db, input.batchId, input.rowNo, input.patch);
    revalidatePath(`/d/${ctx.deptSlug}/imports`);
    return { errors: summary.errors, warnings: summary.warnings };
  },
);

export const skipImportRowAction = safeAction(
  z.object({ batchId: z.string().min(1), rowNo: z.number().int().min(1) }),
  async ({ input, ctx, db }) => {
    await assertMayEdit(db, ctx, input.batchId);
    await skipRow(db, input.batchId, input.rowNo);
    const summary = await validateBatch(db, input.batchId);
    revalidatePath(`/d/${ctx.deptSlug}/imports`);
    return { errors: summary.errors };
  },
);

export const saveMappingAction = safeAction(
  z.object({
    batchId: z.string().min(1),
    mappings: z.record(z.string(), z.string()),
    /** Keeps the answer for next time under this name. */
    profileName: z.string().trim().min(1).max(80).optional(),
  }),
  async ({ input, ctx, db }) => {
    await assertMayEdit(db, ctx, input.batchId);
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: input.batchId } });
    const summary = (batch.summaryJson ?? {}) as Record<string, unknown>;
    await db.importBatch.update({
      where: { id: input.batchId },
      data: { summaryJson: toJson({ ...summary, mappings: input.mappings, missingRequired: [] }) },
    });

    if (input.profileName) {
      const profile = await db.columnMappingProfile.upsert({
        where: {
          departmentId_kind_name: {
            departmentId: ctx.departmentId,
            kind: batch.kind,
            name: input.profileName,
          },
        },
        update: { mappingsJson: toJson(input.mappings) },
        create: {
          departmentId: ctx.departmentId,
          kind: batch.kind,
          name: input.profileName,
          mappingsJson: toJson(input.mappings),
        },
      });
      await db.importBatch.update({
        where: { id: input.batchId },
        data: { mappingProfileId: profile.id },
      });
    }

    revalidatePath(`/d/${ctx.deptSlug}/imports`);
    return { batchId: input.batchId };
  },
);
