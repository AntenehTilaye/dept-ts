import type { Job, PgBoss } from "pg-boss";

export interface HandlerContext {
  boss: PgBoss;
}

export interface WorkerHandler<T = unknown> {
  /** Queue name from src/platform/scheduler/queues.ts. */
  queue: string;
  batchSize?: number;
  pollingIntervalSeconds?: number;
  handle(jobs: Job<T>[], ctx: HandlerContext): Promise<void>;
}
