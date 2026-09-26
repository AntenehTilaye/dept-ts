import { seedFeatures as seedFeatureDefinitions } from "../../../src/platform/feature/seed";
import { caseFeature } from "./case";
import { committee } from "./committee";
import { committeeReport } from "./committee_report";
import { genericRequest } from "./generic_request";
import { importBatch } from "./import_batch";
import { task } from "./task";

// The built-ins, parents first. Every later phase adds its module's definition here; the seed
// only ever writes the locked subtree, so an administrator's edits survive a deployment.
//
// Placement (design part 00, "seed placement"): P9 generic_request, task, case ·
// P10 import_batch (presets roster, class_timetable) · P12 committee, committee_report ·
// P13 course_offering + import presets assessment, attendance, students · P14 portfolio, cqi ·
// P15 campaign · P17 meeting · P18 appointment · P20 annual_plan, planned_activity,
// quarterly_report · P21 exam_schedule · P22 lab_schedule · P25 load_cycle ·
// P26 student_issue, announcement.
export const SEED_FEATURES = [
  task,
  caseFeature,
  genericRequest,
  importBatch,
  committee,
  committeeReport,
];

export async function seedFeatures(): Promise<void> {
  await seedFeatureDefinitions(SEED_FEATURES);
}
