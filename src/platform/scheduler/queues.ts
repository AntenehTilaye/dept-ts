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
    name: "outbox.dispatch",
    policy: "short",
    retryLimit: 3,
    expireInSeconds: 60,
    cron: "* * * * *",
  },
  {
    name: "reminder.materialize",
    policy: "short",
    retryLimit: 2,
    expireInSeconds: 300,
    cron: "0 * * * *",
  },
  {
    name: "reminder.fire",
    policy: "standard",
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 120,
  },
  {
    name: "notification.deliver",
    policy: "standard",
    retryLimit: 3,
    retryDelay: 15,
    expireInSeconds: 120,
  },
  // dead-letter queues are declared before the queues that point at them
  { name: "email.dead", policy: "standard", retryLimit: 0, expireInSeconds: 60 },
  {
    name: "email.send",
    policy: "standard",
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter: "email.dead",
  },
  {
    name: "workflow.auto_transition",
    policy: "standard",
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 120,
  },
  {
    name: "overdue.sweep",
    policy: "short",
    retryLimit: 1,
    expireInSeconds: 600,
    cron: "15 * * * *",
  },
  {
    name: "grant.reconcile",
    policy: "short",
    retryLimit: 1,
    expireInSeconds: 900,
    cron: "0 3 * * *",
  },
  {
    name: "calendar.autotransition",
    policy: "short",
    retryLimit: 1,
    expireInSeconds: 600,
    cron: "*/15 * * * *",
  },
  {
    name: "campaign.open",
    policy: "standard",
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 600,
  },
  {
    name: "campaign.close",
    policy: "standard",
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 600,
  },
  {
    name: "campaign.aggregate",
    policy: "standard",
    retryLimit: 2,
    retryDelay: 60,
    expireInSeconds: 900,
  },
  {
    name: "feature.migrate",
    policy: "singleton",
    retryLimit: 3,
    retryDelay: 30,
    expireInSeconds: 1800,
  },
  {
    name: "recurrence.spawn",
    policy: "short",
    retryLimit: 1,
    expireInSeconds: 600,
    cron: "*/15 * * * *",
  },
  // a report in pdf needs a browser and a workbook can be large, so both are rendered by the
  // worker; the singleton key is the report, its parameters and the format
  {
    name: "report.generate",
    policy: "singleton",
    retryLimit: 2,
    expireInSeconds: 600,
  },
  // a file too large to read inside a request is read by the worker instead; the states of the
  // import are the same either way
  {
    name: "import.parse",
    policy: "standard",
    retryLimit: 1,
    expireInSeconds: 900,
  },
  {
    name: "import.validate",
    policy: "standard",
    retryLimit: 1,
    expireInSeconds: 900,
  },
  {
    name: "retention.run",
    policy: "short",
    retryLimit: 1,
    expireInSeconds: 1800,
    cron: "0 4 * * 0",
  },
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
