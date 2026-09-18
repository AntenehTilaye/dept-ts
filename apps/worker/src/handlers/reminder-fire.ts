import { fromJson } from "@/lib/db/json";
import { withTenantTx } from "@/lib/db/tenant";
import { markDone, markFailed, markRunning } from "@/platform/scheduler/ledger";
import { notify } from "@/platform/scheduler/notify";
import { DeadlineSpec } from "@/platform/scheduler/offsets";
import { materializeSubscription } from "@/platform/scheduler/reminders";
import { label } from "@/platform/subject-registry";
import type { AudienceSpec } from "@/platform/people/audience";
import type { WorkerHandler } from "./types";

export interface ReminderFireData {
  subscriptionId: string;
  idempotencyKey: string;
  departmentId: string;
  offsetDays: number;
  templateKey: string;
  channels: Array<"in_app" | "email" | "sms">;
  overdue: boolean;
  interval?: boolean;
}

/**
 * Fires one materialised reminder: skipped (ledger `cancelled`) when the subscription is gone,
 * inactive or the subject left `whileInStates`; otherwise notifies the audience once (the
 * notification dedupe key equals the ledger key) and schedules the next interval run.
 */
const handler: WorkerHandler<ReminderFireData> = {
  queue: "reminder.fire",
  batchSize: 5,
  pollingIntervalSeconds: 1,
  async handle(jobs) {
    for (const job of jobs) {
      const d = job.data;
      await withTenantTx(d.departmentId, async (tx) => {
        const ledger = await tx.scheduledJob.findUnique({
          where: { idempotencyKey: d.idempotencyKey },
        });
        if (!ledger || ledger.status === "cancelled" || ledger.status === "done") return;
        await markRunning(tx, d.idempotencyKey);
        const sub = await tx.reminderSubscription.findUnique({ where: { id: d.subscriptionId } });
        if (!sub || !sub.active) {
          await tx.scheduledJob.update({ where: { id: ledger.id }, data: { status: "cancelled" } });
          return;
        }
        const spec = DeadlineSpec.parse(sub.deadlineSpecJson);
        const instance = await tx.workflowInstance.findFirst({
          where: { subjectType: sub.subjectType, subjectId: sub.subjectId },
        });
        if (
          "everyDays" in spec &&
          spec.whileInStates.length &&
          (!instance || !spec.whileInStates.includes(instance.currentState))
        ) {
          await tx.scheduledJob.update({ where: { id: ledger.id }, data: { status: "cancelled" } });
          await tx.reminderSubscription.update({ where: { id: sub.id }, data: { active: false } });
          return;
        }
        try {
          const subject = { subjectType: sub.subjectType, subjectId: sub.subjectId };
          const subjectLabel = await label(tx, subject).catch(() => subject.subjectId);
          const due = sub.resolvedDeadlineAt?.toISOString().slice(0, 10) ?? "";
          await notify(tx, d.departmentId, {
            audienceSpec: fromJson<AudienceSpec>(sub.audienceSpecJson),
            templateKey: d.templateKey,
            title: d.overdue ? `Overdue: ${subjectLabel}` : `Reminder: ${subjectLabel}`,
            body: d.overdue
              ? `${subjectLabel} was due ${due}.`
              : `${subjectLabel} is due ${due || "soon"}.`,
            variables: {
              ...fromJson<Record<string, unknown>>(sub.variablesJson),
              subject_label: subjectLabel,
              deadline: due,
              days: Math.abs(d.offsetDays),
              state: instance?.currentState ?? "",
            },
            category: d.overdue ? "deadline_missed" : "deadline_approaching",
            subject,
            dedupeKey: d.idempotencyKey,
            channels: d.channels,
            confirmMassSend: true,
          });
          await markDone(tx, d.idempotencyKey);
          if (d.interval) await materializeSubscription(tx, sub.id, new Date(Date.now() + 1000));
        } catch (error) {
          await markFailed(
            tx,
            d.idempotencyKey,
            error instanceof Error ? error.message : String(error),
          );
          throw error;
        }
      });
    }
  },
};

export default handler;
