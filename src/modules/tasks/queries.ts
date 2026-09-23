import type { DeptCtx } from "@/lib/auth/require";
import { actorOf } from "@/lib/auth/require";
import type { Db } from "@/lib/db/types";
import { history } from "@/platform/audit/history";
import { canContribute } from "@/platform/document";
import { gateFor } from "@/platform/document/gate";
import { taskDefinition } from "@/platform/workflow/definitions/task";
import { availableActions } from "@/platform/workflow/engine";
import {
  acknowledgements,
  assigneeDetail,
  deliverableStatus,
  taskInstance,
  taskOf,
} from "@/platform/workitem";
import type { TimelineStep } from "@/components/feature/StepTimeline";

// Page-level read model of a task: everything RecordDetail needs in one call.

/** The happy path of the task machine, marked against the transitions already taken. */
export function timelineOf(
  currentState: string,
  taken: Array<{ toState: string; at: Date; actorUserId: string | null }>,
): TimelineStep[] {
  const path = ["draft", "assigned", "in_progress", "submitted", "under_review", "completed"];
  const index = path.indexOf(currentState);
  const lastOf = (state: string) => taken.filter((t) => t.toState === state).at(-1);
  const terminal = currentState === "cancelled";
  return path.map((key, i) => {
    const state = taskDefinition.states.find((s) => s.key === key)!;
    const hit = lastOf(key);
    const status: TimelineStep["status"] = terminal
      ? hit
        ? "done"
        : "skipped"
      : key === currentState
        ? "current"
        : index >= 0 && i < index
          ? "done"
          : "pending";
    return {
      key,
      label: state.label,
      status,
      at: hit?.at.toISOString() ?? null,
      actor: hit?.actorUserId ?? null,
    };
  });
}

export async function taskDetail(ctx: DeptCtx, db: Db, taskId: string) {
  const task = await taskOf(db, taskId);
  if (!task) return null;
  const actor = actorOf(ctx);
  const subject = { subjectType: "task", subjectId: taskId };
  const instance = await taskInstance(db, taskId);
  const [actions, slots, acks, assignees, timeline, contribute] = await Promise.all([
    instance ? availableActions(db, instance.id, actor) : Promise.resolve([]),
    deliverableStatus(db, taskId),
    acknowledgements(db, taskId),
    assigneeDetail(db, taskId),
    history(db, subject, 50),
    canContribute(gateFor(db, actor), subject),
  ]);
  const transitions = timeline
    .filter((e) => e.kind === "transition")
    .map((e) => ({ toState: e.toState!, at: e.at, actorUserId: e.actorUserId }));
  const ackByPerson = new Map(acks.perPerson.map((p) => [p.personId, p]));
  return {
    task,
    instance,
    actions,
    slots,
    assignees: assignees.map((a) => {
      const ack = ackByPerson.get(a.personId);
      return {
        ...a,
        status: ack?.status ?? ("pending" as const),
        at: ack?.at ? ack.at.toISOString() : null,
        reason: ack?.reason ?? null,
      };
    }),
    history: timeline,
    canContribute: contribute.allowed,
    steps: timelineOf(instance?.currentState ?? "draft", transitions),
  };
}
