import type { JobStatus } from "@/generated/prisma/enums";
import { getBoss } from "../../lib/db/boss";
import type { Db } from "../../lib/db/types";

// The ScheduledJob ledger: status transitions driven by the worker handlers, cancellation by
// key prefix (subject re-anchoring), and the dry run the admin reminders page shows.

export async function markRunning(db: Db, idempotencyKey: string): Promise<void> {
  await db.scheduledJob.updateMany({
    where: { idempotencyKey, status: { in: ["scheduled", "sent"] } },
    data: { status: "running", attempts: { increment: 1 } },
  });
}

export async function markDone(db: Db, idempotencyKey: string): Promise<void> {
  await db.scheduledJob.updateMany({
    where: { idempotencyKey },
    data: { status: "done", lastError: null },
  });
}

export async function markSent(db: Db, idempotencyKey: string): Promise<void> {
  await db.scheduledJob.updateMany({
    where: { idempotencyKey, status: "scheduled" },
    data: { status: "sent" },
  });
}

export async function markFailed(db: Db, idempotencyKey: string, error: string): Promise<void> {
  await db.scheduledJob.updateMany({
    where: { idempotencyKey },
    data: { status: "failed", lastError: error.slice(0, 2000) },
  });
}

/** Marks a ledger row cancelled (worker handlers skip cancelled keys) and cancels the pg-boss job. */
export async function cancelByPrefix(
  db: Db,
  prefix: string,
  opts: { bossCancel?: boolean } = {},
): Promise<number> {
  const rows = await db.scheduledJob.findMany({
    where: { idempotencyKey: { startsWith: prefix }, status: { in: ["scheduled", "sent"] } },
  });
  if (rows.length === 0) return 0;
  await db.scheduledJob.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { status: "cancelled" },
  });
  if (opts.bossCancel !== false) {
    const boss = await getBoss();
    for (const r of rows) {
      if (r.pgBossJobId) await boss.cancel(r.queue, r.pgBossJobId).catch(() => undefined);
    }
  }
  return rows.length;
}

export async function ledgerRow(db: Db, idempotencyKey: string) {
  return db.scheduledJob.findUnique({ where: { idempotencyKey } });
}

export interface LedgerFilter {
  status?: JobStatus[];
  kind?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export async function listJobs(db: Db, filter: LedgerFilter = {}) {
  return db.scheduledJob.findMany({
    where: {
      ...(filter.status?.length ? { status: { in: filter.status } } : {}),
      ...(filter.kind ? { kind: filter.kind as never } : {}),
      ...(filter.from || filter.to
        ? {
            runAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { runAt: "desc" },
    take: filter.limit ?? 200,
  });
}

/** What would fire in [from, to]: the scheduled reminder rows plus their audience sizes. */
export async function dryRun(db: Db, departmentId: string, from: Date, to: Date) {
  const rows = await db.scheduledJob.findMany({
    where: {
      departmentId,
      kind: "reminder",
      status: { in: ["scheduled", "sent"] },
      runAt: { gte: from, lte: to },
    },
    orderBy: { runAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    runAt: r.runAt,
    idempotencyKey: r.idempotencyKey,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    payload: r.payloadJson,
  }));
}
