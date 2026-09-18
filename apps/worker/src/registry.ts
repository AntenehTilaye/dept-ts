import type { PgBoss } from "pg-boss";
import type { WorkerHandler } from "./handlers/types";
import workerHeartbeat from "./handlers/worker-heartbeat";

// One default export per queue, file named after the queue with "." -> "-".
// Later phases append their handlers here.
export const HANDLERS: readonly WorkerHandler[] = [workerHeartbeat];

export async function registerHandlers(
  boss: PgBoss,
  handlers: readonly WorkerHandler[] = HANDLERS,
): Promise<void> {
  for (const h of handlers) {
    await boss.work(
      h.queue,
      { batchSize: h.batchSize ?? 1, pollingIntervalSeconds: h.pollingIntervalSeconds ?? 2 },
      async (jobs) => {
        await h.handle(jobs, { boss });
      },
    );
  }
}
