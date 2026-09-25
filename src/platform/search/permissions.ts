import { globalSingleton } from "../../lib/singleton";
import { registerPermissionFallback } from "../identity/can";

// A search hit is checked with `can(actor, "<type>.view", ref)`, but most subject types are not
// their own permission module: a course is governed by `academic.manage`, a person by
// `staff.view`. These are those mappings, registered once — the check stays uniform and the
// catalogue stays the single list of real permissions.

const state = globalSingleton("search-permission-fallbacks", () => ({ installed: false }));

const FALLBACKS: Record<string, string> = {
  person: "staff.view",
  staff_profile: "staff.view",
  course: "academic.manage",
  course_offering: "academic.manage",
  section: "academic.manage",
  section_offering: "academic.manage",
  resource: "resource.view",
  group: "committee.view",
  campaign: "campaign.manage",
  generated_report: "task.view",
};

export function installSearchPermissions(): void {
  if (state.installed) return;
  state.installed = true;
  for (const [prefix, key] of Object.entries(FALLBACKS)) registerPermissionFallback(prefix, key);
}
