import type { Prisma } from "@/generated/prisma/client";
import { runWithAudit } from "@/platform/audit/context";
import { prismaRoot } from "./prisma";
import { globalSingleton } from "../singleton";

// Transaction helpers around the two RLS settings.
//   withTenantTx     - one transaction with `app.current_department_id` set once at the start
//                      (multi-row writes, raw SQL, nested writes: RLS filters everything inside)
//   withTenantBypass - `app.tenant_bypass = 'on'` for faculty-wide work (admin pages, seeds,
//                      grant reconciliation, retention). Every use is audited (from the audit
//                      phase on; until then it is logged).

export type TxClient = Prisma.TransactionClient;

export interface TenantTxOptions {
  maxWait?: number;
  timeout?: number;
}

export type BypassActor =
  { isAdmin: true; user: { id: string } } | { worker: true; jobName: string };

export async function withTenantTx<T>(
  departmentId: string,
  fn: (tx: TxClient) => Promise<T>,
  opts: TenantTxOptions = {},
): Promise<T> {
  return prismaRoot.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_department_id', ${departmentId}, true)`;
      // awaited inside the scope so lazily executed Prisma promises see the context
      return runWithAudit({ tx, departmentId, bypass: false }, async () => await fn(tx));
    },
    { maxWait: 5_000, timeout: 15_000, ...opts },
  );
}

export type BypassAuditor = (tx: TxClient, actor: BypassActor, reason: string) => Promise<void>;

const auditorHolder = globalSingleton("bypass-auditor", () => ({
  fn: (async (_tx, actor, reason) => {
    const who = "worker" in actor ? `job:${actor.jobName}` : `user:${actor.user.id}`;
    console.warn(`[tenant-bypass] ${who}: ${reason}`);
  }) as BypassAuditor,
}));

/** The audit phase registers the AuditEvent writer here. */
export function setBypassAuditor(fn: BypassAuditor): void {
  auditorHolder.fn = fn;
}

export async function withTenantBypass<T>(
  actor: BypassActor,
  reason: string,
  fn: (tx: TxClient) => Promise<T>,
  opts: TenantTxOptions = {},
): Promise<T> {
  return prismaRoot.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_bypass', 'on', true)`;
      const actorUserId = "user" in actor ? actor.user.id : null;
      return runWithAudit({ tx, bypass: true, actorUserId }, async () => {
        await auditorHolder.fn(tx, actor, reason);
        return await fn(tx);
      });
    },
    { maxWait: 5_000, timeout: 15_000, ...opts },
  );
}
