import { PgBoss, type JobWithMetadata } from "pg-boss";
import { inject } from "vitest";
import { ensureQueues } from "@/lib/db/boss";
import { HANDLERS, registerHandlers } from "../../apps/worker/src/registry";
import type { WorkerHandler } from "../../apps/worker/src/handlers/types";

/** Starts a real pg-boss on the per-run schema with the real worker handlers (fast polling). */
export async function startTestBoss(
  handlers: readonly WorkerHandler[] = HANDLERS,
): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    schema: inject("bossSchema"),
    migrate: true,
    supervise: true,
    schedule: false,
    max: 4,
  });
  boss.on("error", (error) => console.error("[pg-boss:test]", error));
  await boss.start();
  await ensureQueues(boss);
  await registerHandlers(
    boss,
    handlers.map((h) => ({ ...h, pollingIntervalSeconds: 0.5 })),
  );
  return boss;
}

/** Polls until the job reaches a terminal state and returns it. */
export async function awaitJob(
  boss: PgBoss,
  queue: string,
  id: string,
  timeoutMs = 20_000,
): Promise<JobWithMetadata<unknown>> {
  const started = Date.now();
  for (;;) {
    const job = await boss.getJobById(queue, id);
    if (job && (job.state === "completed" || job.state === "failed" || job.state === "cancelled"))
      return job;
    if (Date.now() - started > timeoutMs)
      throw new Error(`job ${queue}/${id} did not finish in ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
