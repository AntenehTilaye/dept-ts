import { registerCaseAdapters } from "./cases/adapters";
import { registerTaskSurface } from "./tasks/surface";
import { registerTaskAdapters } from "./tasks/adapters";

// Every module's code-backed parts, imported by src/lib/bootstrap.ts (web) and the worker entry
// point so both processes carry the same registry — a definition that names an adapter must find
// it wherever a transition happens to be applied.

export function registerModules(): void {
  registerTaskAdapters();
  registerCaseAdapters();
  registerTaskSurface();
}
