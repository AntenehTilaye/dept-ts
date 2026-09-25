"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { toJson } from "@/lib/db/json";
import { fixRow, skipRow, validateBatch } from "@/platform/import";

// What the import surfaces do. Each one is small on purpose: the pipeline holds the behaviour,
// and these only carry a person's decision into it.

export const fixImportRowAction = safeAction(
  z.object({
    batchId: z.string().min(1),
    rowNo: z.number().int().min(1),
    patch: z.record(z.string(), z.unknown()),
  }),
  async ({ input, ctx, db }) => {
    const summary = await fixRow(db, input.batchId, input.rowNo, input.patch);
    revalidatePath(`/d/${ctx.deptSlug}/imports`);
    return { errors: summary.errors, warnings: summary.warnings };
  },
  { permission: "import.manage" },
);

export const skipImportRowAction = safeAction(
  z.object({ batchId: z.string().min(1), rowNo: z.number().int().min(1) }),
  async ({ input, ctx, db }) => {
    await skipRow(db, input.batchId, input.rowNo);
    const summary = await validateBatch(db, input.batchId);
    revalidatePath(`/d/${ctx.deptSlug}/imports`);
    return { errors: summary.errors };
  },
  { permission: "import.manage" },
);

export const saveMappingAction = safeAction(
  z.object({
    batchId: z.string().min(1),
    mappings: z.record(z.string(), z.string()),
    /** Keeps the answer for next time under this name. */
    profileName: z.string().trim().min(1).max(80).optional(),
  }),
  async ({ input, ctx, db }) => {
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
  { permission: "import.manage" },
);
