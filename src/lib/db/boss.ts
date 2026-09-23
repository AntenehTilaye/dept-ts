import { PgBoss } from "pg-boss";
import { QUEUES, type QueueSpec } from "@/platform/scheduler/queues";

// Send-only pg-boss client for the web process (no supervision, no scheduling, no
// migrations: the worker owns the `pgboss` schema). Started lazily on first use.
const globalForBoss = globalThis as unknown as { __boss?: Promise<PgBoss> };

export function bossOptions(schema = process.env.PGBOSS_SCHEMA ?? "pgboss") {
  return {
    connectionString: process.env.DATABASE_URL,
    schema,
    max: 2,
    supervise: false,
    schedule: false,
    migrate: false,
  };
}

function defined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function queueOptions(q: QueueSpec) {
  return defined({
    policy: q.policy,
    retryLimit: q.retryLimit,
    retryDelay: q.retryDelay,
    retryBackoff: q.retryBackoff,
    expireInSeconds: q.expireInSeconds,
    deadLetter: q.deadLetter,
  });
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const q of QUEUES) {
    if (!(await boss.getQueue(q.name))) {
      await boss.createQueue(q.name, queueOptions(q));
    }
  }
}

export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.__boss) {
    globalForBoss.__boss = (async () => {
      const boss = new PgBoss(bossOptions());
      boss.on("error", (error) => console.error("[pg-boss:web]", error));
      await boss.start();
      await ensureQueues(boss);
      return boss;
    })();
  }
  return globalForBoss.__boss;
}

/**
 * Stops the lazily started client. Long-running processes never call this; one-shot scripts
 * (the seed, CLI tools) must, or the open pool keeps the process alive.
 */
export async function stopBoss(): Promise<void> {
  const pending = globalForBoss.__boss;
  if (!pending) return;
  globalForBoss.__boss = undefined;
  const boss = await pending.catch(() => null);
  await boss?.stop({ graceful: false, timeout: 5_000 }).catch(() => undefined);
}
