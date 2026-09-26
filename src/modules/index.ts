import { registerCaseAdapters } from "./cases/adapters";
import { registerCommitteeAdapters } from "./committees/adapters";
import { registerCommitteeReports } from "./committees/reports";
import { registerCommitteeSubjects } from "./committees/registry";
import { registerCommitteeSearch } from "./committees/search";
import { registerImportAdapters } from "./imports/adapters";
import { registerTaskAdapters } from "./tasks/adapters";

// Every module's code-backed parts, imported by src/lib/bootstrap.ts (web) and the worker entry
// point so both processes carry the same registry — a definition that names an adapter must find
// it wherever a transition happens to be applied. What a module adds to a *page* is React, so it
// is registered by the page instead (src/modules/record-surfaces.ts).

export function registerModules(): void {
  registerTaskAdapters();
  registerCaseAdapters();
  registerImportAdapters();
  registerCommitteeAdapters();
  registerCommitteeSubjects();
  registerCommitteeReports();
  registerCommitteeSearch();
}
