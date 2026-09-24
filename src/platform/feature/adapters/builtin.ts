import { globalSingleton } from "../../../lib/singleton";
import { registerAdapter } from "./registry";

// The guards every compiled feature leans on. They are declared here so a definition that names
// them validates and the administrator can see them in the adapter list; the implementations
// live with the runtime (runtime/effects.ts), because answering "may this actor act" needs the
// record, the step instance and the identity service.

export const BUILTIN_GUARDS = [
  {
    key: "feature.actorAllowed",
    description: "The actor satisfies one of the action's actor rules.",
  },
  {
    key: "feature.stepComplete",
    description: "Required answers, attachments and the comment of the step are there.",
  },
  {
    key: "feature.parallelComplete",
    description: "The parallel group reached its completion rule.",
  },
  { key: "feature.parentActive", description: "The parent record has not been closed." },
  {
    key: "feature.deadlineNotPassed",
    description: "The step's deadline has not passed yet.",
  },
  {
    key: "feature.autoOnEvent",
    description: "An automatic action waiting for a domain event may fire.",
  },
] as const;

const state = globalSingleton("feature-builtin-adapters", () => ({ installed: false }));

/** Registers the built-in adapters; idempotent, called by both processes at boot. */
export function registerBuiltinAdapters(): void {
  if (state.installed) return;
  state.installed = true;
  for (const guard of BUILTIN_GUARDS)
    registerAdapter({
      key: guard.key,
      module: "feature",
      hook: "guard",
      description: guard.description,
      simulable: true,
      run: async () => true,
    });
}
