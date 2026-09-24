import type { Db } from "../../../lib/db/types";
import type { Actor } from "../../identity/can";
import { addAssignees } from "../../workitem/assignments";
import type { CreateTaskInput } from "../../workitem/service";
import { act } from "./act";
import { createRecord } from "./create";

// Work spawned by something else — a transition that asks for a follow-up, a recurrence rule
// that repeats yesterday's task — is a task like any other, so it is created the way every task
// is: as a record of the `task` feature. Nothing in the system owns a second task lifecycle.

export interface SpawnedTask {
  recordId: string;
  taskId: string;
}

/** The presets of the built-in `task` feature, by the TaskKind they stand for. */
const KIND_PRESETS = new Set([
  "general",
  "committee_task",
  "department_task",
  "instructor_task",
  "student_activity",
  "administrative",
  "action_item",
  "cqi_action",
  "maintenance",
  "lab_activity",
]);

export async function createTaskRecord(
  tx: Db,
  departmentId: string,
  actor: Actor,
  input: CreateTaskInput,
  opts: { assign?: boolean } = {},
): Promise<SpawnedTask> {
  const creator = await creatorOf(tx, departmentId, actor, input.context ?? null);
  const assignees = input.assignees ?? [];
  const person = assignees.find((a) => a.type === "person");
  const group = assignees.find((a) => a.type === "group");
  const audience = assignees.filter((a) => a.type === "audience");
  const kind = input.kind ?? "general";

  const record = await createRecord(tx, departmentId, creator, "task", {
    ...(KIND_PRESETS.has(kind) ? { presetKey: kind } : {}),
    parentRef: input.context ?? null,
    data: {
      title: input.title,
      description: input.description ?? undefined,
      ...(KIND_PRESETS.has(kind) ? {} : { kind }),
      ...(person?.id ? { assignee: person.id } : {}),
      ...(group?.id ? { assignee_group: group.id } : {}),
      ...(audience.length
        ? { audience: audience.flatMap((a) => a.audienceSpec?.roles ?? []) }
        : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.dueAt ? { due_at: input.dueAt.toISOString() } : {}),
      ...(input.expectedDeliverables?.length
        ? { deliverables: input.expectedDeliverables }
        : {}),
    },
  });

  const taskId = (await tx.featureRecord.findUniqueOrThrow({
    where: { id: record.id },
    select: { taskId: true },
  })).taskId!;

  // the header names one person and one group; anybody else the caller asked for is an
  // assignment of the task itself, which is where assignments live anyway
  const rest = assignees.filter((a) => a !== person && a !== group && a.type !== "audience");
  if (rest.length) await addAssignees(tx, departmentId, taskId, rest, input.title);

  // the spawn already decided this task exists, so assigning it is the system's move, not the
  // creator's: the relational permission check could not see a record created in this same
  // transaction anyway (the resolver reads on its own connection)
  if (opts.assign !== false)
    await act(tx, record.id, "draft", "assign", { ...creator, isAdmin: true });
  return { recordId: record.id, taskId };
}

/**
 * A record is owned by a person, so spawned work needs one even when a timer did the spawning:
 * the actor's own person, the person behind their user, or the owner of the record the work
 * came out of.
 */
async function creatorOf(
  tx: Db,
  departmentId: string,
  actor: Actor,
  context: { subjectType: string; subjectId: string } | null,
): Promise<Actor> {
  if (actor.personId) return actor;
  const byUser = actor.userId
    ? await tx.person.findFirst({ where: { userId: actor.userId }, select: { id: true } })
    : null;
  if (byUser) return { ...actor, personId: byUser.id };
  if (context?.subjectType === "feature_record") {
    const parent = await tx.featureRecord.findUnique({
      where: { id: context.subjectId },
      select: { ownerPersonId: true },
    });
    if (parent) return { ...actor, personId: parent.ownerPersonId };
  }
  throw new Error(
    "a task record needs a person to own it: give the actor a person, or spawn the task from a record",
  );
}
