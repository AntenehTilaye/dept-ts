import type { Db } from "@/lib/db/types";
import { registerAdapter } from "@/platform/feature/adapters/registry";
import { registerGuard, type GuardContext } from "@/platform/workflow/guards";
import { registerHandler, type EffectContext } from "@/platform/workflow/effects";
import type { GuardVerdict } from "@/platform/workflow/machine";

// A module adapter has to exist in two places: in the AdapterRegistry, so a definition that
// names it validates and an administrator can see it, and in the workflow engine, which is what
// actually calls it. These two helpers do both, so a module registers each adapter once.

export interface ModuleAdapter {
  key: string;
  module: string;
  description: string;
  simulable?: boolean;
}

export function registerFeatureGuard(
  adapter: ModuleAdapter,
  guard: (ctx: GuardContext) => Promise<GuardVerdict> | GuardVerdict,
): void {
  registerAdapter({ ...adapter, hook: "guard", run: async () => true });
  registerGuard(adapter.key, guard);
}

export function registerFeatureEffect(
  adapter: ModuleAdapter,
  effect: (ctx: EffectContext, args: Record<string, unknown>) => Promise<void>,
): void {
  registerAdapter({ ...adapter, hook: "effect", run: async () => undefined });
  registerHandler(adapter.key, effect);
}

/** An on_enter / on_exit adapter runs with the feature runtime's adapter context. */
export function registerStepAdapter(
  adapter: ModuleAdapter & { hook: "on_enter" | "on_exit" | "compute" | "validate" | "backing" },
  run: (ctx: {
    tx: Db;
    departmentId: string;
    record?: { id: string; definitionKey: string; data: Record<string, unknown>; presetKey?: string | null };
    stepInstance?: { id: string; stepKey: string; branchKey?: string | null };
  }) => Promise<Record<string, unknown> | void>,
): void {
  registerAdapter({
    key: adapter.key,
    module: adapter.module,
    hook: adapter.hook,
    description: adapter.description,
    simulable: adapter.simulable ?? false,
    run: async (ctx) => (await run(ctx)) ?? undefined,
  });
}

/** The Task a workflow subject stands for: a task-backed feature record IS a task. */
export async function taskIdOfSubject(
  tx: Db,
  subject: { subjectType: string; subjectId: string },
): Promise<string | null> {
  if (subject.subjectType === "task") return subject.subjectId;
  if (subject.subjectType !== "feature_record") return null;
  const record = await tx.featureRecord.findUnique({
    where: { id: subject.subjectId },
    select: { taskId: true },
  });
  return record?.taskId ?? null;
}
