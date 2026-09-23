import type { PrismaClient } from "../../../src/generated/prisma/client";
import {
  taskDefinition,
  TASK_DEFINITION_KEY,
} from "../../../src/platform/workflow/definitions/task";
import { upsertDefinition } from "../../../src/platform/workflow/registry";

// Workflow definitions are compiled from FeatureDefinitions (key "feature:<key>") by the
// feature phase; nothing else is seeded here. The only rows allowed to exist without a
// featureVersionId are the provisional definitions listed below — today just the work-item
// `task` machine, retired again once the feature kernel compiles and backfills `feature:task`.
export const PROVISIONAL_DEFINITION_KEYS: readonly string[] = [TASK_DEFINITION_KEY];

export async function seedWorkflows(db: PrismaClient): Promise<void> {
  const existing = await db.workflowDefinition.findFirst({
    where: { key: TASK_DEFINITION_KEY, departmentId: null, status: "active" },
  });
  if (existing) return;
  await upsertDefinition(taskDefinition, { activate: true });
}
