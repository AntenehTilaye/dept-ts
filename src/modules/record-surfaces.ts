import { globalSingleton } from "@/lib/singleton";
import { registerCommitteeSurfaces } from "./committees/surface";
import { registerImportSurface } from "./imports/register-surface";
import { registerTaskSurface } from "./tasks/surface";

// Surfaces are React, so they are registered by the page that renders them rather than at
// bootstrap: the seed and the worker load the module registry outside Next, where a "use server"
// module refuses to load, and Next's client manifest only sees a component a server module
// imports statically.

const state = globalSingleton("record-surfaces", () => ({ installed: false }));

export function registerRecordSurfaces(): void {
  if (state.installed) return;
  state.installed = true;
  registerTaskSurface();
  registerImportSurface();
  registerCommitteeSurfaces();
}
