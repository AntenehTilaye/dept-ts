// Shared pg-boss queue catalogue. The worker creates every queue at boot; the web process
// only sends to them. Later phases append their queues here (never create ad hoc queues).

export type QueuePolicy = "standard" | "short" | "singleton" | "stately" | "exclusive";

export interface QueueSpec {
  name: string;
  policy: QueuePolicy;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
  deadLetter?: string;
  /** Cron expression registered by the worker (tz = APP_TIMEZONE). */
  cron?: string;
}

export const QUEUES: readonly QueueSpec[] = [
  {
    name: "worker.heartbeat",
    policy: "short",
    retryLimit: 0,
    expireInSeconds: 30,
    cron: "* * * * *",
  },
] as const;

export type QueueName = (typeof QUEUES)[number]["name"];

export function queueSpec(name: string): QueueSpec {
  const spec = QUEUES.find((q) => q.name === name);
  if (!spec) throw new Error(`Unknown queue "${name}"; add it to src/platform/scheduler/queues.ts`);
  return spec;
}
