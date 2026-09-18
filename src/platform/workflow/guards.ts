import { globalSingleton } from "../../lib/singleton";
import type { Db } from "../../lib/db/types";
import type { Actor } from "../identity/can";
import type { GuardVerdict } from "./machine";
import type { Definition, WorkflowTransitionJson } from "./schema";

// Named guards evaluated before a transition. Modules and feature presets register theirs;
// unknown guard names fail closed.

export interface GuardContext {
  tx: Db;
  definition: Definition;
  instance: {
    id: string;
    subjectType: string;
    subjectId: string;
    currentState: string;
    departmentId: string;
  };
  transition: WorkflowTransitionJson;
  actor: Actor | null;
  input: {
    comment?: string;
    fields?: Record<string, unknown>;
    payload?: unknown;
    branchKey?: string;
  };
}

export type Guard = (ctx: GuardContext) => Promise<GuardVerdict> | GuardVerdict;

const guards = globalSingleton("workflow-guards", () => new Map<string, Guard>());

export function registerGuard(name: string, guard: Guard): void {
  guards.set(name, guard);
}

export function hasGuard(name: string): boolean {
  return guards.has(name);
}

export async function evaluateGuard(name: string, ctx: GuardContext): Promise<GuardVerdict> {
  const g = guards.get(name);
  if (!g) return { ok: false, reason: `unknown guard "${name}"` };
  return g(ctx);
}

/** Built-ins. `feature.parallelComplete` is implied by the machine (it only emits $join when complete). */
registerGuard("feature.parallelComplete", () => true);
registerGuard("always", () => true);
registerGuard("never", () => ({ ok: false, reason: "blocked by definition" }));
registerGuard("comment.present", ({ input }) =>
  input.comment?.trim() ? true : { ok: false, reason: "a comment is required" },
);
