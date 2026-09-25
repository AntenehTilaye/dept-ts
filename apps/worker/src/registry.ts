import type { PgBoss } from "pg-boss";
import type { WorkerHandler } from "./handlers/types";
import calendarAutotransition from "./handlers/calendar-autotransition";
import campaignAggregate from "./handlers/campaign-aggregate";
import campaignClose from "./handlers/campaign-close";
import campaignOpen from "./handlers/campaign-open";
import emailDead from "./handlers/email-dead";
import featureMigrate from "./handlers/feature-migrate";
import emailSend from "./handlers/email-send";
import grantReconcile from "./handlers/grant-reconcile";
import importParse from "./handlers/import-parse";
import importValidate from "./handlers/import-validate";
import notificationDeliver from "./handlers/notification-deliver";
import outboxDispatch from "./handlers/outbox-dispatch";
import projectionRebuild from "./handlers/projection-rebuild";
import overdueSweep from "./handlers/overdue-sweep";
import reminderFire from "./handlers/reminder-fire";
import reportGenerate from "./handlers/report-generate";
import searchReindex from "./handlers/search-reindex";
import recurrenceSpawn from "./handlers/recurrence-spawn";
import reminderMaterialize from "./handlers/reminder-materialize";
import retentionRun from "./handlers/retention-run";
import workerHeartbeat from "./handlers/worker-heartbeat";
import workflowAutoTransition from "./handlers/workflow-auto-transition";

// One default export per queue, file named after the queue with "." -> "-".
// Later phases append their handlers here.
export const HANDLERS: readonly WorkerHandler[] = [
  outboxDispatch,
  reminderMaterialize,
  reminderFire,
  notificationDeliver,
  emailSend,
  emailDead,
  workflowAutoTransition,
  importParse,
  importValidate,
  reportGenerate,
  searchReindex,
  projectionRebuild,
  overdueSweep,
  calendarAutotransition,
  grantReconcile,
  recurrenceSpawn,
  campaignOpen,
  campaignClose,
  campaignAggregate,
  featureMigrate,
  retentionRun,
  workerHeartbeat,
] as WorkerHandler[];

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
