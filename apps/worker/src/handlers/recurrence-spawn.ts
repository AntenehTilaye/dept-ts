import { prismaRoot } from "@/lib/db/prisma";
import { withTenantTx } from "@/lib/db/tenant";
import { fromJson } from "@/lib/db/json";
import { runWithAudit } from "@/platform/audit/context";
import { claimLedgerJob } from "@/platform/scheduler/ledger";
import { createTaskRecord } from "@/platform/feature";
import { nextOccurrence } from "@/platform/workitem";
import type { WorkerHandler } from "./types";

// Every 15 minutes: spawns the next occurrence of every recurrence rule whose nextSpawnAt has
// passed. RecurrenceRule is a tenant table, so the scan runs per department inside a
// department transaction (the root client sees nothing under RLS). The ledger key
// `recurrence:{ruleId}:{isoNextSpawnAt}` makes a second run a no-op.

const handler: WorkerHandler = {
  queue: "recurrence.spawn",
  async handle() {
    const now = new Date();
    const departments = await prismaRoot.department.findMany({ select: { id: true } });
    for (const d of departments) {
      await withTenantTx(d.id, async (tx) => {
        const due = await tx.recurrenceRule.findMany({
          where: { nextSpawnAt: { lte: now } },
          take: 200,
        });
        for (const rule of due) {
          const at = rule.nextSpawnAt!;
          const idempotencyKey = `recurrence:${rule.id}:${at.toISOString()}`;
          const claimed = await claimLedgerJob(tx, idempotencyKey, {
            kind: "recurrence_spawn",
            queue: "recurrence.spawn",
            runAt: at,
            departmentId: d.id,
          });
          if (!claimed) continue;
          const template = rule.templateTaskId
            ? await tx.task.findUnique({
                where: { id: rule.templateTaskId },
                include: { assignments: true },
              })
            : null;
          if (!template) continue;
          await runWithAudit(
            { departmentId: d.id, actorUserId: null, correlationId: idempotencyKey },
            async () => {
              await createTaskRecord(
                tx,
                d.id,
                { userId: template.createdBy, personId: null, departmentId: d.id, isAdmin: true },
                {
                  title: template.title,
                  description: template.description,
                  kind: template.kind,
                  priority: template.priority,
                  context:
                    template.contextType && template.contextId
                      ? { subjectType: template.contextType, subjectId: template.contextId }
                      : null,
                  assignees: template.assignments.map((a) => ({
                    type: a.assigneeType,
                    id: a.assigneeId,
                    role: a.role,
                  })),
                  dueAt: at,
                  expectedDeliverables: fromJson(template.expectedDeliverablesJson),
                  reminderScheduleKey: template.reminderScheduleKey,
                },
              );
            },
          );
          const spawnedCount = rule.spawnedCount + 1;
          await tx.recurrenceRule.update({
            where: { id: rule.id },
            data: {
              spawnedCount,
              nextSpawnAt: nextOccurrence(
                {
                  frequency: rule.frequency,
                  interval: rule.interval,
                  byWeekday: rule.byWeekday,
                  byMonthDay: rule.byMonthDay,
                  startsOn: rule.startsOn,
                  endsOn: rule.endsOn,
                  count: rule.count,
                  timezone: rule.timezone,
                },
                at,
                spawnedCount,
              ),
            },
          });
        }
      });
    }
  },
};

export default handler;
