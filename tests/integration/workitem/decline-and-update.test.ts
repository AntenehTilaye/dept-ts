import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { dispatchPending } from "@/platform/audit/outbox";
import type { Actor } from "@/platform/identity/can";
import { decline } from "@/platform/scheduler/inbox";
import { list } from "@/platform/thread";
import { createTask, requestUpdate, setDeadline } from "@/platform/workitem";
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

describe("declining, nudging and moving the deadline", () => {
  it("declining posts a comment on the task thread and notifies the creator", async () => {
    const task = await withTenantTx(DEPT_CS, (tx) =>
      createTask(tx, head, {
        title: "Invigilate the CS201 final",
        assignees: [{ type: "person", id: instructorPersonId }],
      }),
    );
    const n = await migratorDb.notification.findFirstOrThrow({
      where: { subjectType: "task", subjectId: task.id, recipientPersonId: instructorPersonId },
    });
    await withTenantTx(DEPT_CS, (tx) =>
      decline(tx, instructorPersonId, n.id, "I am at a conference that week"),
    );
    await dispatchPending(100);

    const thread = await migratorDb.thread.findFirstOrThrow({
      where: { subjectType: "task", subjectId: task.id, kind: "comments" },
    });
    const comments = await withTenantTx(DEPT_CS, (tx) => list(tx, head, thread.id));
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain("declined this assignment");
    expect(comments[0]!.body).toContain("conference");

    // notify() appends the recipient to the caller's key
    const toCreator = await migratorDb.notification.findUniqueOrThrow({
      where: { dedupeKey: `task:${task.id}:declined:${instructorPersonId}:${headPersonId}` },
    });
    expect(toCreator.recipientPersonId).toBe(headPersonId);
    expect(toCreator.body).toContain("conference");
    // the acknowledgement state reflects the decline
    const acks = await migratorDb.notification.findMany({
      where: { subjectType: "task", subjectId: task.id, ackRequired: true },
    });
    expect(acks.every((a) => a.declinedAt !== null)).toBe(true);
  });

  it("requestUpdate notifies the responsible assignees once per minute key", async () => {
    const task = await withTenantTx(DEPT_CS, (tx) =>
      createTask(tx, head, {
        title: "Where are we?",
        assignees: [{ type: "person", id: instructorPersonId }],
      }),
    );
    const n = await withTenantTx(DEPT_CS, (tx) =>
      requestUpdate(tx, head, task.id, "Any progress on the draft?"),
    );
    expect(n).toBe(1);
    const again = await withTenantTx(DEPT_CS, (tx) =>
      requestUpdate(tx, head, task.id, "Any progress on the draft?"),
    );
    expect(again).toBe(0); // deduped
    const row = await migratorDb.notification.findFirstOrThrow({
      where: {
        subjectType: "task",
        subjectId: task.id,
        recipientPersonId: instructorPersonId,
        category: "assignment",
        templateKey: "task_update_request",
      },
    });
    expect(row.body).toContain("Any progress");
  });

  it("moving the deadline cancels the old reminder keys and schedules new ones", async () => {
    const first = new Date(Date.now() + 3 * DAY);
    const task = await withTenantTx(DEPT_CS, (tx) =>
      createTask(tx, head, {
        title: "Moving target",
        dueAt: first,
        assignees: [{ type: "person", id: instructorPersonId }],
      }),
    );
    const before = await migratorDb.scheduledJob.findMany({
      where: { subjectType: "task", subjectId: task.id },
    });
    expect(before.length).toBeGreaterThan(0);

    const second = new Date(Date.now() + 10 * DAY);
    await withTenantTx(DEPT_CS, (tx) => setDeadline(tx, head, task.id, second));
    expect(
      (await migratorDb.task.findUniqueOrThrow({ where: { id: task.id } })).dueAt?.getTime(),
    ).toBe(second.getTime());
    const cancelled = await migratorDb.scheduledJob.findMany({
      where: { idempotencyKey: { in: before.map((b) => b.idempotencyKey) } },
    });
    expect(cancelled.every((c) => c.status === "cancelled")).toBe(true);
    const subscription = await migratorDb.reminderSubscription.findFirstOrThrow({
      where: { subjectType: "task", subjectId: task.id, active: true },
    });
    expect(subscription.resolvedDeadlineAt?.getTime()).toBe(second.getTime());
    const instance = await migratorDb.workflowInstance.findFirstOrThrow({
      where: { subjectType: "task", subjectId: task.id },
    });
    expect(instance.dueAt?.getTime()).toBe(second.getTime());
  });
});
