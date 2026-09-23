import { seedFeatures as seedFeatureDefinitions } from "../../../src/platform/feature/seed";
import { caseFeature } from "./case";
import { genericRequest } from "./generic_request";
import { task } from "./task";

// The built-ins, parents first. Every later phase adds its module's definition here; the seed
// only ever writes the locked subtree, so an administrator's edits survive a deployment.
export const SEED_FEATURES = [task, caseFeature, genericRequest];

export async function seedFeatures(): Promise<void> {
  await seedFeatureDefinitions(SEED_FEATURES);
}
