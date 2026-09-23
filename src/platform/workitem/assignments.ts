import type { AssignmentRole } from "@/generated/prisma/enums";
import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import {
  dbAudienceLoader,
  resolveAudienceIds,
  snapshotAudienceAsGroup,
  type AudienceSpec,
} from "../people/audience";
import { membersOf } from "../people/groups";

// Assignments of a task: a person, a group, or an audience snapshotted into an ad-hoc group at
// creation time (so a later membership change does not silently re-target the task).

export interface AssigneeSpec {
  type: "person" | "group" | "audience";
  /** person id or group id; omitted for audience. */
  id?: string;
  audienceSpec?: AudienceSpec;
  role?: AssignmentRole;
}

export interface AssignmentRow {
  id: string;
  assigneeType: "person" | "group";
  assigneeId: string;
  role: AssignmentRole;
}

/** Creates the assignment rows of a task, snapshotting audiences into ad-hoc groups. */
export async function addAssignees(
  db: Db,
  departmentId: string,
  taskId: string,
  assignees: AssigneeSpec[],
  taskTitle: string,
): Promise<AssignmentRow[]> {
  const rows: AssignmentRow[] = [];
  for (const a of assignees) {
    const role = a.role ?? "responsible";
    if (a.type === "audience") {
      if (!a.audienceSpec) throw new Error("An audience assignee needs an audienceSpec");
      const { group } = await snapshotAudienceAsGroup(db, departmentId, a.audienceSpec, {
        subjectType: "feature_record",
        subjectId: taskId,
        name: `Task audience: ${taskTitle}`,
      });
      rows.push(
        await upsertAssignment(db, departmentId, taskId, "group", group.id, role, a.audienceSpec),
      );
      continue;
    }
    if (!a.id) throw new Error(`A ${a.type} assignee needs an id`);
    rows.push(await upsertAssignment(db, departmentId, taskId, a.type, a.id, role));
  }
  return rows;
}

async function upsertAssignment(
  db: Db,
  departmentId: string,
  taskId: string,
  assigneeType: "person" | "group",
  assigneeId: string,
  role: AssignmentRole,
  audienceSpec?: AudienceSpec,
): Promise<AssignmentRow> {
  const row = await db.taskAssignment.upsert({
    where: {
      taskId_assigneeType_assigneeId_role: { taskId, assigneeType, assigneeId, role },
    },
    create: {
      departmentId,
      taskId,
      assigneeType,
      assigneeId,
      role,
      sourceAudienceSpecJson: audienceSpec ? toJson(audienceSpec) : undefined,
    },
    update: {},
  });
  return {
    id: row.id,
    assigneeType: row.assigneeType,
    assigneeId: row.assigneeId,
    role: row.role,
  };
}

export async function removeAssignment(db: Db, assignmentId: string): Promise<void> {
  await db.taskAssignment.delete({ where: { id: assignmentId } });
}

/** Every person behind a task's assignments (group members expanded), optionally by role. */
export async function assigneePersonIds(
  db: Db,
  taskId: string,
  role?: AssignmentRole,
  asOf = new Date(),
): Promise<string[]> {
  const rows = await db.taskAssignment.findMany({
    where: { taskId, ...(role ? { role } : {}) },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.assigneeType === "person") ids.add(r.assigneeId);
    else for (const m of await membersOf(db, r.assigneeId, asOf)) ids.add(m.personId);
  }
  return Array.from(ids);
}

/** Whether a person is an assignee of the task (directly or through a group). */
export async function isAssignee(db: Db, taskId: string, personId: string): Promise<boolean> {
  return (await assigneePersonIds(db, taskId)).includes(personId);
}

/** Re-resolves a group assignment's audience (repair path after membership changes). */
export async function refreshAudienceAssignment(
  db: Db,
  departmentId: string,
  assignmentId: string,
  asOf = new Date(),
): Promise<number> {
  const row = await db.taskAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
  if (row.assigneeType !== "group" || !row.sourceAudienceSpecJson) return 0;
  const spec = row.sourceAudienceSpecJson as AudienceSpec;
  const wanted = await resolveAudienceIds(spec, dbAudienceLoader(db, departmentId, asOf));
  const current = (await membersOf(db, row.assigneeId, asOf)).map((m) => m.personId);
  const missing = wanted.filter((id) => !current.includes(id));
  if (missing.length)
    await db.groupMembership.createMany({
      data: missing.map((personId) => ({
        departmentId,
        groupId: row.assigneeId,
        personId,
        roleInGroup: "member" as const,
        validFrom: asOf,
      })),
    });
  return missing.length;
}
