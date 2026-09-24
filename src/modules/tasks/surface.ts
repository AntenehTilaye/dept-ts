import { canContribute } from "@/platform/document";
import { gateFor } from "@/platform/document/gate";
import { acknowledgements, assigneeDetail, deliverableStatus } from "@/platform/workitem";
import { registerSurface, type RecordExtras, type SurfaceContext } from "../surfaces";

// What a task-backed record shows beyond the generic page: the slots it has to hand in, and who
// has acknowledged being assigned to it. Both live on the Task the record IS, so they are read
// through the work-item service rather than the feature runtime.

export function registerTaskSurface(): void {
  for (const featureKey of ["task", "case"])
    registerSurface({ featureKey, recordExtras: taskRecordExtras });
}

async function taskRecordExtras({ ctx, db, record }: SurfaceContext): Promise<RecordExtras> {
  if (!record.taskId) return {};
  // inlined rather than imported: this module is registered at bootstrap, which the tests load
  // outside Next, and @/lib/auth/require is server-only
  const actor = {
    userId: ctx.user.id,
    personId: ctx.personId,
    departmentId: ctx.departmentId,
    isAdmin: ctx.isAdmin,
  };
  const subject = { subjectType: "task", subjectId: record.taskId };

  const [slots, acks, assignees, contribute] = await Promise.all([
    deliverableStatus(db, record.taskId),
    acknowledgements(db, record.taskId),
    assigneeDetail(db, record.taskId),
    canContribute(gateFor(db, actor), subject),
  ]);

  const ackByPerson = new Map(acks.perPerson.map((p) => [p.personId, p]));
  return {
    slots,
    slotSubject: subject,
    canUploadSlots: contribute.allowed,
    acknowledgements: assignees.map((a) => {
      const ack = ackByPerson.get(a.personId);
      return {
        ...a,
        status: ack?.status ?? ("pending" as const),
        at: ack?.at ? ack.at.toISOString() : null,
        reason: ack?.reason ?? null,
      };
    }),
  };
}
