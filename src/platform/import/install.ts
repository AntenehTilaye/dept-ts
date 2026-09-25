import { globalSingleton } from "../../lib/singleton";
import { commitClassTimetable } from "./committers/class_timetable";
import { commitRoster } from "./committers/roster";
import { registerCommitter } from "./committers/registry";
import { validateClassTimetable } from "./validators/class_timetable";
import { validateRoster } from "./validators/roster";
import { registerValidator } from "./validators/registry";

// The kinds the platform itself knows how to read and write. A module phase adds its own by
// registering a validator and a committer under its kind — the pipeline never changes.

const state = globalSingleton("import-kinds", () => ({ installed: false }));

export function installImportKinds(): void {
  if (state.installed) return;
  state.installed = true;

  registerValidator("roster", validateRoster);
  registerCommitter("roster", commitRoster);

  registerValidator("class_timetable", validateClassTimetable);
  registerCommitter("class_timetable", commitClassTimetable);
}
