import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { dispatchPending } from "@/platform/audit/outbox";
import type { Actor } from "@/platform/identity/can";
import { decline } from "@/platform/scheduler/inbox";
import { list } from "@/platform/thread";
import { createTaskRecord } from "@/platform/feature";
import { requestUpdate, setDeadline, transition } from "@/platform/workitem";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

let head: Actor;
let headPersonId: string;
let instructorPersonId: string;

async function actorFor(email: string, personId: string): Promise<Actor> {
  const user = await migratorDb.user.findUniqueOrThrow({ where: { email } });
  return { userId: user.id, personId, departmentId: DEPT_CS, isAdmin: user.role === "admin" };
}

beforeAll(async () => {
  const [u1, u2] = await Promise.all([
    migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "instructor1.cs@deptts.local" } }),
  ]);
  const [p1, p2] = await Promise.all([
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS, { userId: u1.id, email: "dh.cs@deptts.local" })),
    withDept(DEPT_CS, (tx) =>
      f.staff(tx, DEPT_CS, { userId: u2.id, email: "instructor1.cs@deptts.local" }),
    ),
  ]);
  headPersonId = p1.id;
  instructorPersonId = p2.id;
  head = await actorFor("dh.cs@deptts.local", p1.id);
});

const DAY = 86_400_000;

// A task is a record of the `task` feature, so the tests create one the way everything else
// does and then use the work-item service the task pages call.
async function newTask(input: Parameters<typeof createTaskRecord>[3]) {
  return withTenantTx(DEPT_CS, (tx) => createTaskRecord(tx, DEPT_CS, head, input));
}

describe("declining, nudging and moving the deadline", () => {
  it("declining posts a comment on the task thread and notifies the creator", async () => {
    const { recordId, taskId } = await newTask({
      title: "Invigilate the CS201 final",
      assignees: [{ type: "person", id: instructorPersonId }],
    });
    const n = await migratorDb.notification.findFirstOrThrow({
      where: {
        subjectType: "feature_record",
        subjectId: recordId,
        recipientPersonId: instructorPersonId,
      },
    });
    await withTenantTx(DEPT_CS, (tx) =>
      decline(tx, instructorPersonId, n.id, "I am at a conference that week"),
    );
    await dispatchPending(100);

    const thread = await migratorDb.thread.findFirstOrThrow({
      where: { subjectType: "task", subjectId: taskId, kind: "comments" },
    });
    const comments = await withTenantTx(DEPT_CS, (tx) => list(tx, head, thread.id));
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain("declined this assignment");
    expect(comments[0]!.body).toContain("conference");

    // notify() appends the recipient to the caller's key
    const toCreator = await migratorDb.notification.findUniqueOrThrow({
      where: { dedupeKey: `task:${taskId}:declined:${instructorPersonId}:${headPersonId}` },
    });
    expect(toCreator.recipientPersonId).toBe(headPersonId);
    expect(toCreator.body).toContain("conference");
    // the acknowledgement state reflects the decline
    const acks = await migratorDb.notification.findMany({
      where: { subjectType: "feature_record", subjectId: recordId, ackRequired: true },
    });
    expect(acks.every((a) => a.declinedAt !== null)).toBe(true);
  });

  it("requestUpdate notifies the responsible assignees once per minute key", async () => {
    const { taskId } = await newTask({
      title: "Where are we?",
      assignees: [{ type: "person", id: instructorPersonId }],
    });
    const n = await withTenantTx(DEPT_CS, (tx) =>
      requestUpdate(tx, head, taskId, "Any progress on the draft?"),
    );
    expect(n).toBe(1);
    const again = await withTenantTx(DEPT_CS, (tx) =>
      requestUpdate(tx, head, taskId, "Any progress on the draft?"),
    );
    expect(again).toBe(0); // deduped
    const row = await migratorDb.notification.findFirstOrThrow({
      where: {
        subjectType: "task",
        subjectId: taskId,
        recipientPersonId: instructorPersonId,
        category: "assignment",
        templateKey: "task_update_request",
      },
    });
    expect(row.body).toContain("Any progress");
  });

  it("moving the deadline cancels the old reminder keys and schedules new ones", async () => {
    const first = new Date(Date.now() + 3 * DAY);
    const { recordId, taskId } = await newTask({
      title: "Moving target",
      dueAt: first,
      assignees: [{ type: "person", id: instructorPersonId }],
    });
    // the reminders belong to the step being worked on
    await withTenantTx(DEPT_CS, (tx) => transition(tx, head, taskId, "start", { system: true }));
    const step = await migratorDb.featureStepInstance.findFirstOrThrow({
      where: { recordId, stepKey: "in_progress", status: "active" },
    });
    const subject = { subjectType: "feature_step_instance" as const, subjectId: step.id };
    const before = await migratorDb.scheduledJob.findMany({ where: subject });
    expect(before.length).toBeGreaterThan(0);

    const second = new Date(Date.now() + 10 * DAY);
    await withTenantTx(DEPT_CS, (tx) => setDeadline(tx, head, taskId, second));
    expect(
      (await migratorDb.task.findUniqueOrThrow({ where: { id: taskId } })).dueAt?.getTime(),
    ).toBe(second.getTime());
    const cancelled = await migratorDb.scheduledJob.findMany({
      where: { idempotencyKey: { in: before.map((b) => b.idempotencyKey) } },
    });
    expect(cancelled.every((c) => c.status === "cancelled")).toBe(true);
    const subscription = await migratorDb.reminderSubscription.findFirstOrThrow({
      where: { ...subject, active: true },
    });
    expect(subscription.resolvedDeadlineAt?.getTime()).toBe(second.getTime());
    // the record and its step moved with it
    expect(
      (
        await migratorDb.featureStepInstance.findUniqueOrThrow({ where: { id: step.id } })
      ).deadlineAt?.getTime(),
    ).toBe(second.getTime());
    const instance = await migratorDb.workflowInstance.findFirstOrThrow({
      where: { subjectType: "feature_record", subjectId: recordId },
    });
    expect(instance.dueAt?.getTime()).toBe(second.getTime());
  });
});
