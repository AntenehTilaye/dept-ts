// Workflow definitions are compiled from FeatureDefinitions (key "feature:<key>") by the
// feature kernel; nothing is seeded here any more. The provisional `task` machine of P7 was
// retired once `feature:task` compiled and every Task row was backfilled with a record, so a
// definition without a featureVersionId is now a defect — which is what this list asserts.
export const PROVISIONAL_DEFINITION_KEYS: readonly string[] = [];

