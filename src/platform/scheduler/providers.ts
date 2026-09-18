import { globalSingleton } from "../../lib/singleton";
import type { Db } from "../../lib/db/types";

// Registries the periodic worker handlers iterate: later phases add work by registration
// (overdue sweeps, calendar catch-ups, retention) instead of new handlers.

export interface ProviderContext {
  tx: Db;
  departmentId: string;
  now: Date;
}

export type OverdueProvider = (ctx: ProviderContext) => Promise<number>;
export type CatchUpProvider = (ctx: ProviderContext) => Promise<number>;
export type RetentionProvider = (tx: Db, now: Date) => Promise<number>;

const registry = globalSingleton("scheduler-providers", () => ({
  overdue: new Map<string, OverdueProvider>(),
  catchUp: new Map<string, CatchUpProvider>(),
  retention: new Map<string, RetentionProvider>(),
}));

export function registerOverdueProvider(key: string, fn: OverdueProvider): void {
  registry.overdue.set(key, fn);
}
export function registerCatchUpProvider(key: string, fn: CatchUpProvider): void {
  registry.catchUp.set(key, fn);
}
export function registerRetentionProvider(key: string, fn: RetentionProvider): void {
  registry.retention.set(key, fn);
}
export function overdueProviders() {
  return Array.from(registry.overdue.entries());
}
export function catchUpProviders() {
  return Array.from(registry.catchUp.entries());
}
export function retentionProviders() {
  return Array.from(registry.retention.entries());
}

/** Built-in retention: published domain events older than 30 days. */
registerRetentionProvider("outbox.purge", async (tx) => {
  const rows = await tx.$queryRaw<
    Array<{ n: number }>
  >`SELECT purge_domain_events(now() - interval '30 days') AS n`;
  return rows[0]?.n ?? 0;
});
