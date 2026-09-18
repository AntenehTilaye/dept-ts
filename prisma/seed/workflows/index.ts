import type { PrismaClient } from "../../../src/generated/prisma/client";

// Workflow definitions are compiled from FeatureDefinitions (key "feature:<key>") by the
// feature phase; nothing is seeded here directly. The only rows allowed to exist without a
// featureVersionId are the provisional definitions listed below (the work-item phase adds the
// provisional `task` definition, retired again once the feature kernel seeds the real one).
export const PROVISIONAL_DEFINITION_KEYS: readonly string[] = [];

export async function seedWorkflows(_db: PrismaClient): Promise<void> {
  // intentionally empty in milestone 1 (see PROVISIONAL_DEFINITION_KEYS)
}
