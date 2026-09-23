import type { ZodType } from "zod";
import type { AdapterHook } from "@/generated/prisma/enums";
import { globalSingleton } from "../../../lib/singleton";
import type { Db } from "../../../lib/db/types";
import type { Actor } from "../../identity/can";
import type { GuardVerdict } from "../../workflow/machine";

// What code offers a definition. A definition never contains logic: where it needs some — a
// guard the workflow cannot express, a module row to create, options to fetch — it names an
// adapter, and this registry is the list of names that exist. Both processes register the same
// adapters at boot (web through bootstrap, worker through its entry point) and mirror them into
// `adapter_registration`, so publish can refuse a definition that points at nothing and the
// administrator can see what they may reference.

export type { AdapterHook };

export interface AdapterContext {
  tx: Db;
  actor: Actor | null;
  departmentId: string;
  /** The record the adapter runs for, when there is one. */
  record?: { id: string; definitionKey: string; data: Record<string, unknown>; presetKey?: string | null };
  stepInstance?: { id: string; stepKey: string; branchKey?: string | null };
  /** The transition being applied, for guard and effect adapters. */
  transition?: { key: string; action: string; from: string; to: string };
}

export interface Adapter<Input = Record<string, unknown>, Output = unknown> {
  key: string;
  /** The module that owns it: tasks, cases, portfolio, ... */
  module: string;
  hook: AdapterHook;
  description: string;
  /** Whether the simulator may run it against a stub context. */
  simulable?: boolean;
  inputSchema?: ZodType<Input>;
  run: (ctx: AdapterContext, input: Input) => Promise<Output>;
}

/** A guard adapter answers the workflow's question directly. */
export type GuardAdapter = Adapter<Record<string, unknown>, GuardVerdict>;

const registry = globalSingleton("feature-adapters", () => new Map<string, Adapter<never, never>>());

export class UnknownAdapterError extends Error {
  constructor(key: string, hook?: AdapterHook) {
    super(hook ? `No ${hook} adapter "${key}" is registered` : `No adapter "${key}" is registered`);
    this.name = "UnknownAdapterError";
  }
}

export function registerAdapter<I, O>(adapter: Adapter<I, O>): void {
  registry.set(adapter.key, adapter as unknown as Adapter<never, never>);
}

export function getAdapter(key: string): Adapter | undefined {
  return registry.get(key) as unknown as Adapter | undefined;
}

export function listAdapters(): Adapter[] {
  return Array.from(registry.values()) as unknown as Adapter[];
}

/** key -> hook, the shape `validateDefinition` wants. */
export function adapterHooks(): Record<string, AdapterHook> {
  return Object.fromEntries(listAdapters().map((a) => [a.key, a.hook]));
}

export function assertExists(key: string, hook?: AdapterHook): Adapter {
  const adapter = getAdapter(key);
  if (!adapter || (hook && adapter.hook !== hook)) throw new UnknownAdapterError(key, hook);
  return adapter;
}

/** Runs an adapter, validating its input when it declares a schema. */
export async function runAdapter<O = unknown>(
  key: string,
  ctx: AdapterContext,
  input: Record<string, unknown> = {},
  hook?: AdapterHook,
): Promise<O> {
  const adapter = assertExists(key, hook);
  const parsed = adapter.inputSchema ? adapter.inputSchema.parse(input) : input;
  return (await adapter.run(ctx, parsed as never)) as O;
}

/** Mirrors the in-memory registry into the table the admin page and publish read. */
export async function syncRegistrations(db: Db): Promise<number> {
  const adapters = listAdapters();
  for (const adapter of adapters)
    await db.adapterRegistration.upsert({
      where: { key: adapter.key },
      create: {
        key: adapter.key,
        module: adapter.module,
        hook: adapter.hook,
        description: adapter.description,
        simulable: adapter.simulable ?? false,
      },
      update: {
        module: adapter.module,
        hook: adapter.hook,
        description: adapter.description,
        simulable: adapter.simulable ?? false,
      },
    });
  return adapters.length;
}

/** Only for tests that need a clean slate. */
export function clearAdapters(): void {
  registry.clear();
}
