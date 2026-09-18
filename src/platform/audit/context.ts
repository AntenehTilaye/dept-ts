import { AsyncLocalStorage } from "node:async_hooks";
import { globalSingleton } from "../../lib/singleton";
import type { Db } from "../../lib/db/types";

// Who is acting, in which department, on which transaction. Set by the action wrappers (web)
// and job handlers (worker), extended by withTenantTx/withTenantBypass/scoped clients with the
// transaction they open, read by the audit interceptor and the outbox.

export interface AuditContext {
  actorUserId: string | null;
  correlationId: string | null;
  departmentId: string | null;
  /** The open transaction audit rows and events must be written on. */
  tx?: Db;
  bypass?: boolean;
  clientInfo?: Record<string, unknown>;
}

const storage = globalSingleton("audit-als", () => new AsyncLocalStorage<AuditContext>());

export function currentAudit(): AuditContext | undefined {
  return storage.getStore();
}

/** Runs `fn` with the given context merged over the current one. */
export function runWithAudit<T>(patch: Partial<AuditContext>, fn: () => Promise<T>): Promise<T> {
  const base: AuditContext = storage.getStore() ?? {
    actorUserId: null,
    correlationId: null,
    departmentId: null,
  };
  return storage.run({ ...base, ...patch }, fn);
}

/** The client audit rows should be written with: the ambient transaction, else the given fallback. */
export function auditDb(fallback: Db): Db {
  return storage.getStore()?.tx ?? fallback;
}
