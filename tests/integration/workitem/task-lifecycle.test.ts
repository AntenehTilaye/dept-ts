import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { LocalDiskStorage, setStorage } from "@/lib/storage";
import { dispatchPending } from "@/platform/audit/outbox";
import { upload } from "@/platform/document";
import type { Actor } from "@/platform/identity/can";
import { acknowledge } from "@/platform/scheduler/inbox";
import { createTaskRecord } from "@/platform/feature";
import {
  actionsFor,
  deliverableStatus,
  listTasks,
  myWork,
  taskInstance,
  taskOf,
  transition,
} from "@/platform/workitem";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

let root: string;
let head: Actor;
let instructor: Actor;
let instructorPersonId: string;
let otherPersonId: string;

async function actorFor(email: string, personId: string | null): Promise<Actor> {
  const user = await migratorDb.user.findUniqueOrThrow({ where: { email } });
  return { userId: user.id, personId, departmentId: DEPT_CS, isAdmin: user.role === "admin" };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "deptts-tasks-"));
  setStorage(new LocalDiskStorage(root));
  const [u1, u2] = await Promise.all([
    migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "instructor1.cs@deptts.local" } }),
  ]);
  const [p1, p2, p3] = await Promise.all([
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS, { userId: u1.id, email: "dh.cs@deptts.local" })),
    withDept(DEPT_CS, (tx) =>
      f.staff(tx, DEPT_CS, { userId: u2.id, email: "instructor1.cs@deptts.local" }),
    ),
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
  ]);
  instructorPersonId = p2.id;
  otherPersonId = p3.id;
  head = await actorFor("dh.cs@deptts.local", p1.id);
  instructor = await actorFor("instructor1.cs@deptts.local", p2.id);
});
afterAll(async () => {
  setStorage(null);
  await rm(root, { recursive: true, force: true });
});

const DAY = 86_400_000;

// Every task is a record of the `task` feature — that is what gives it a lifecycle — so these
// tests create them the way the runtime does and then drive them through the work-item service,
// which is what the task pages and the nudge actions use.
async function newTask(input: Parameters<typeof createTaskRecord>[3]) {
  const spawned = await withTenantTx(DEPT_CS, (tx) => createTaskRecord(tx, DEPT_CS, head, input));
  const task = await withTenantTx(DEPT_CS, (tx) => taskOf(tx, spawned.taskId));
  return { ...spawned, task: task! };
}

describe("task lifecycle", () => {
  it("creates, assigns, notifies with an acknowledgement and schedules the reminders", async () => {
    const dueAt = new Date(Date.now() + 2 * DAY);
    const { recordId, taskId, task } = await newTask({
      title: "Prepare the exam paper",
      kind: "instructor_task",
      dueAt,
      assignees: [{ type: "person", id: instructorPersonId }],
      expectedDeliverables: [
        { key: "paper", label: "Examination paper", required: true },
        { key: "guide", label: "Marking guide", required: false },
      ],
    });
    expect(task.assignments).toHaveLength(1);
    // the record's workflow instance owns the state; the task row has no status column
    const instance = await withTenantTx(DEPT_CS, (tx) => taskInstance(tx, taskId));
    expect(instance?.currentState).toBe("assigned");
    expect(instance?.subjectType).toBe("feature_record");
    expect(instance?.subjectId).toBe(recordId);
    // the assignment notification is ack-required and declinable
    const notification = await migratorDb.notification.findFirstOrThrow({
      where: {
        subjectType: "feature_record",
        subjectId: recordId,
        recipientPersonId: instructorPersonId,
      },
    });
    expect(notification).toMatchObject({
      ackRequired: true,
      declinable: true,
      category: "assignment",
    });
    expect(notification.title).toContain("Prepare the exam paper");
    // the reminders belong to the step being worked on, and follow its deadline
    await withTenantTx(DEPT_CS, (tx) => transition(tx, instructor, taskId, "start"));
    const step = await migratorDb.featureStepInstance.findFirstOrThrow({
      where: { recordId, stepKey: "in_progress" },
    });
    const subscription = await migratorDb.reminderSubscription.findFirstOrThrow({
      where: { subjectType: "feature_step_instance", subjectId: step.id },
    });
    expect(subscription.resolvedDeadlineAt?.getTime()).toBe(dueAt.getTime());
    expect(
      await migratorDb.scheduledJob.count({
        where: { subjectType: "feature_step_instance", subjectId: step.id },
      }),
    ).toBeGreaterThan(0);
  });

  it("acknowledging the assignment starts the task", async () => {
    const { recordId, taskId } = await newTask({
      title: "Acknowledge me",
      dueAt: new Date(Date.now() + DAY),
      assignees: [{ type: "person", id: instructorPersonId }],
    });
    const n = await migratorDb.notification.findFirstOrThrow({
      where: {
        subjectType: "feature_record",
        subjectId: recordId,
        recipientPersonId: instructorPersonId,
      },
    });
    await withTenantTx(DEPT_CS, (tx) => acknowledge(tx, instructorPersonId, n.id));
    await dispatchPending(100);
    const instance = await withTenantTx(DEPT_CS, (tx) => taskInstance(tx, taskId));
    expect(instance?.currentState).toBe("in_progress");
  });

  it("submit is blocked until every required deliverable slot holds a document", async () => {
    const { taskId } = await newTask({
      title: "Deliverable gate",
      assignees: [{ type: "person", id: instructorPersonId }],
      expectedDeliverables: [{ key: "report", label: "Final report", required: true }],
    });
    await withTenantTx(DEPT_CS, (tx) => transition(tx, instructor, taskId, "start"));
    const before = await withTenantTx(DEPT_CS, (tx) => actionsFor(tx, instructor, taskId));
    const submit = before.actions.find((a) => a.action === "submit")!;
    expect(submit.enabled).toBe(false);
    expect(submit.disabledReason).toContain("Final report");
    await expect(
      withTenantTx(DEPT_CS, (tx) => transition(tx, instructor, taskId, "submit")),
    ).rejects.toThrow(/Final report/);

    await withTenantTx(DEPT_CS, (tx) =>
      upload(
        tx,
        instructor,
        Buffer.from("the report"),
        { title: "Final report", originalName: "report.txt", mimeType: "text/plain" },
        [{ subjectType: "task", subjectId: taskId, linkRole: "deliverable", slotKey: "report" }],
      ),
    );
    const slots = await withTenantTx(DEPT_CS, (tx) => deliverableStatus(tx, taskId));
    expect(slots).toMatchObject([{ key: "report", required: true, satisfied: true }]);
    const after = await withTenantTx(DEPT_CS, (tx) => transition(tx, instructor, taskId, "submit"));
    expect(after.instance.currentState).toBe("submitted");
  });

  it("review and approve write completedAt only through the workflow, and log every transition", async () => {
    const { recordId, taskId } = await newTask({
      title: "Full journey",
      assignees: [{ type: "person", id: instructorPersonId }],
    });
    await withTenantTx(DEPT_CS, (tx) => transition(tx, instructor, taskId, "start"));
    await withTenantTx(DEPT_CS, (tx) => transition(tx, instructor, taskId, "submit"));
    expect(
      (await migratorDb.task.findUniqueOrThrow({ where: { id: taskId } })).completedAt,
    ).toBeNull();
    await withTenantTx(DEPT_CS, (tx) => transition(tx, head, taskId, "review"));
    await withTenantTx(DEPT_CS, (tx) => transition(tx, head, taskId, "approve"));
    const done = await migratorDb.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(done.completedAt).not.toBeNull();
    const instance = await migratorDb.workflowInstance.findFirstOrThrow({
      where: { subjectType: "feature_record", subjectId: recordId },
    });
    expect(instance.currentState).toBe("completed");
    const logs = await migratorDb.workflowTransitionLog.findMany({
      where: { instanceId: instance.id },
      orderBy: { at: "asc" },
    });
    expect(logs.map((l) => l.toState)).toEqual([
      "assigned",
      "in_progress",
      "submitted",
      "under_review",
      "completed",
    ]);
    expect(
      await migratorDb.auditEvent.count({
        where: { subjectType: "feature_record", subjectId: recordId },
      }),
    ).toBeGreaterThan(0);
  });

  it("an audience assignment reaches its members, and listTasks finds them through the group", async () => {
    const { recordId, taskId, task } = await newTask({
      title: "Everyone confirms their office hours",
      kind: "department_task",
      assignees: [{ type: "audience", audienceSpec: { roles: ["instructor"] } }],
    });
    const assignment = task.assignments[0]!;
    expect(assignment.assigneeType).toBe("group");
    const group = await migratorDb.group.findUniqueOrThrow({
      where: { id: assignment.assigneeId },
    });
    expect(group.kind).toBe("adhoc");
    const members = await migratorDb.groupMembership.findMany({ where: { groupId: group.id } });
    expect(members.length).toBeGreaterThan(0);
    const memberPersonId = members[0]!.personId;
    expect(
      await migratorDb.notification.count({
        where: { subjectType: "feature_record", subjectId: recordId, ackRequired: true },
      }),
    ).toBe(members.length);
    const mine = await withTenantTx(DEPT_CS, (tx) => myWork(tx, DEPT_CS, memberPersonId));
    expect(mine.map((t) => t.id)).toContain(taskId);
    // the row carries the record its pages are addressed by
    expect(mine.find((t) => t.id === taskId)?.recordId).toBe(recordId);
    // someone who is not a member does not see it
    const others = await withTenantTx(DEPT_CS, (tx) =>
      listTasks(tx, DEPT_CS, { assigneePersonId: otherPersonId }),
    );
    expect(others.map((t) => t.id)).not.toContain(taskId);
  });

  it("a task always belongs to something: task_backing_check refuses an orphan row", async () => {
    const { taskId } = await newTask({
      title: "Backed by its record",
      assignees: [{ type: "person", id: instructorPersonId }],
    });
    const backed = await migratorDb.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(backed.featureRecordId).not.toBeNull();
    // the database is what enforces it, so nothing can create a task with a lifecycle of its own
    await expect(
      migratorDb.$executeRaw`
        INSERT INTO task (id, department_id, title, kind, priority, created_by,
                          expected_deliverables_json, created_at, updated_at)
        VALUES ('orphan-task', ${DEPT_CS}, 'Nobody owns me', 'general', 'normal', 'system',
                '[]'::jsonb, now(), now())`,
    ).rejects.toThrow(/task_backing_check/);
  });

  it("overdue is computed, never stored", async () => {
    const { taskId } = await newTask({
      title: "Late already",
      dueAt: new Date(Date.now() - DAY),
      assignees: [{ type: "person", id: instructorPersonId }],
    });
    const rows = await withTenantTx(DEPT_CS, (tx) =>
      listTasks(tx, DEPT_CS, { assigneePersonId: instructorPersonId, overdue: true }),
    );
    expect(rows.map((r) => r.id)).toContain(taskId);
    // the column does not exist: only dueAt and completedAt are stored
    const columns = await migratorDb.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'task'`;
    expect(columns.map((c) => c.column_name)).not.toContain("status");
    expect(columns.map((c) => c.column_name)).not.toContain("overdue");
  });
});
