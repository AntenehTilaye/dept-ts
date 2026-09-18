import { PgBoss } from "pg-boss";
import { ensureQueues } from "@/lib/db/boss";

export interface WorkerBossOptions {
  connectionString?: string;
  schema?: string;
  concurrency?: number;
}

/** Creates and starts the worker's pg-boss instance (supervising, scheduling, migrating its schema). */
export async function startWorkerBoss(opts: WorkerBossOptions = {}): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: opts.connectionString ?? process.env.DATABASE_URL,
    schema: opts.schema ?? process.env.PGBOSS_SCHEMA ?? "pgboss",
    max: opts.concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 4),
    migrate: true,
    supervise: true,
    schedule: true,
    clockMonitorIntervalSeconds: 600,
  });
  boss.on("error", (error) => console.error("[pg-boss:worker]", error));
  await boss.start();
  await ensureQueues(boss);
  return boss;
}
