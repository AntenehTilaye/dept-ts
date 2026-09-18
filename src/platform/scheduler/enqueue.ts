import type { JobKind } from "@/generated/prisma/enums";
import { getBoss } from "../../lib/db/boss";
import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { queueSpec } from "./queues";

// Transactional enqueue: pg-boss inserts the job through the caller's Prisma transaction
// connection (per-call `db` adapter), and the ScheduledJob ledger row is written on the same
// transaction, so a rolled-back business transaction leaves neither behind.

export interface BossDb {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export function fromPrisma(tx: Db): BossDb {
  return {
    async executeSql(text, values = []) {
      const rows = (await tx.$queryRawUnsafe(text, ...values)) as unknown[];
      return { rows: Array.isArray(rows) ? rows : [] };
    },
  };
}

export interface EnqueueOptions {
  kind: JobKind;
  idempotencyKey?: string;
  singletonKey?: string;
  startAfter?: Date;
  retryLimit?: number;
  subjectType?: string;
  subjectId?: string;
  departmentId: string | null;
  /** Ledger payload (defaults to the job data). */
  payload?: unknown;
}

export interface EnqueueResult {
  jobId: string | null;
  ledgerId: string | null;
  /** True when an identical idempotency key already existed (nothing was sent). */
  duplicate: boolean;
}

export async function enqueue(
  tx: Db,
  name: string,
  data: Record<string, unknown>,
  opts: EnqueueOptions,
): Promise<EnqueueResult> {
  queueSpec(name);
  if (opts.idempotencyKey) {
    const existing = await tx.scheduledJob.findUnique({
      where: { idempotencyKey: opts.idempotencyKey },
    });
    if (existing && existing.status !== "cancelled" && existing.status !== "failed")
      return { jobId: existing.pgBossJobId, ledgerId: existing.id, duplicate: true };
    if (existing) await tx.scheduledJob.delete({ where: { id: existing.id } });
  }
  const boss = await getBoss();
  const jobId = await boss.send(name, data, {
    db: fromPrisma(tx),
    ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}),
    ...(opts.startAfter ? { startAfter: opts.startAfter } : {}),
    ...(opts.retryLimit !== undefined ? { retryLimit: opts.retryLimit } : {}),
  });
  let ledgerId: string | null = null;
  if (opts.idempotencyKey) {
    const row = await tx.scheduledJob.create({
      data: {
        departmentId: opts.departmentId,
        kind: opts.kind,
        queue: name,
        subjectType: (opts.subjectType ?? null) as never,
        subjectId: opts.subjectId ?? null,
        runAt: opts.startAfter ?? new Date(),
        payloadJson: toJson(opts.payload ?? data),
        idempotencyKey: opts.idempotencyKey,
        status: jobId ? "scheduled" : "cancelled",
        pgBossJobId: jobId,
        singletonKey: opts.singletonKey ?? null,
      },
    });
    ledgerId = row.id;
  }
  return { jobId, ledgerId, duplicate: false };
}
