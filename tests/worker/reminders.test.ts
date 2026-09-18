import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { ledgerRow } from "@/platform/scheduler/ledger";
import { materializeSubscription, subscribeReminders } from "@/platform/scheduler/reminders";
import { isRegistered, replace } from "@/platform/subject-registry";
import emailSend from "../../apps/worker/src/handlers/email-send";
import notificationDeliver from "../../apps/worker/src/handlers/notification-deliver";
import reminderFire from "../../apps/worker/src/handlers/reminder-fire";
import reminderMaterialize from "../../apps/worker/src/handlers/reminder-materialize";
import { migratorDb, withDept } from "../setup/db";
import { DEPT_CS } from "../setup/seed-minimal";
import * as f from "../setup/factories";
import { awaitJob, startTestBoss } from "../setup/boss";

bootstrap();
if (!isRegistered("task")) {
  replace("task", {
    label: async (_db, id) => `Task ${id}`,
    snapshot: async (_db, id) => ({ label: `Task ${id}` }),
    contextOf: async () => ({ departmentId: DEPT_CS }),
    relationships: async () => [],
  });
}

let boss: PgBoss;
beforeAll(async () => {
  boss = await startTestBoss([reminderMaterialize, reminderFire, notificationDeliver, emailSend]);
});
afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
});

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const DAY = 86_400_000;

describe("reminder materialise and fire", () => {
  it("fires a materialised reminder once (even when materialised twice), writes the notification with the ledger key and mails the recipient", async () => {
    const email = `remind.${f.uniqueSuffix()}@deptts.local`;
    const user = await migratorDb.user.findUniqueOrThrow({
      where: { email: "instructor1.cs@deptts.local" },
    });
    const person = await withDept(DEPT_CS, (tx) =>
      f.staff(tx, DEPT_CS, { userId: user.id, email }),
    );
    const subject = { subjectType: "task", subjectId: `r-${f.uniqueSuffix()}` };
    const deadline = new Date(Date.now() + 1_000);
    const { materialized } = await withTenantTx(DEPT_CS, (tx) =>
      subscribeReminders(tx, DEPT_CS, {
        subject,
        deadline: { at: deadline },
        scheduleKey: "default_7_3_1_0_overdue",
        audienceSpec: { persons: [person.id] },
        variables: { title: "Remind me" },
      }),
    );
    const key = `${subject.subjectType}:${subject.subjectId}:default_7_3_1_0_overdue:0`;
    expect(materialized).toContain(key);
    const sub = await migratorDb.reminderSubscription.findFirstOrThrow({
      where: { subjectId: subject.subjectId },
    });
    expect(await withTenantTx(DEPT_CS, (tx) => materializeSubscription(tx, sub.id))).toEqual([]);
    const row = await waitFor(async () => {
      const r = await ledgerRow(migratorDb, key);
      return r?.status === "done" ? r : null;
    });
    expect(row.status).toBe("done");
    const notification = await migratorDb.notification.findUniqueOrThrow({
      where: { dedupeKey: `${key}:${person.id}` },
    });
    expect(notification).toMatchObject({
      category: "deadline_approaching",
      recipientPersonId: person.id,
      subjectType: "task",
      subjectId: subject.subjectId,
    });
    expect(notification.title).toContain(`Task ${subject.subjectId}`);
    const found = await waitFor(async () => {
      const res = await fetch(
        `${process.env.MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(email)}`,
      );
      const body = (await res.json()) as { messages: Array<{ Subject: string }> };
      return body.messages.length ? body.messages : null;
    }, 40_000).catch(async (e: Error) => {
      const d = await migratorDb.notificationDelivery.findMany({
        where: { notificationId: notification.id },
      });
      throw new Error(`${e.message}: deliveries ${JSON.stringify(d)}`);
    });
    expect(found[0]!.Subject).toContain(`Reminder: Task ${subject.subjectId}`);
    const delivery = await migratorDb.notificationDelivery.findFirst({
      where: { notificationId: notification.id, channel: "email" },
    });
    expect(delivery?.status).toBe("sent");
    expect(await migratorDb.notification.count({ where: { dedupeKey: { startsWith: key } } })).toBe(
      1,
    );
  });

  it("a cancelled subscription and a subject outside whileInStates are skipped and end cancelled", async () => {
    const subject = { subjectType: "task", subjectId: `c-${f.uniqueSuffix()}` };
    const person = await withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS));
    const { subscription } = await withTenantTx(DEPT_CS, (tx) =>
      subscribeReminders(tx, DEPT_CS, {
        subject,
        deadline: { at: new Date(Date.now() + 1_500) },
        scheduleKey: "short",
        audienceSpec: { persons: [person.id] },
      }),
    );
    await migratorDb.reminderSubscription.update({
      where: { id: subscription.id },
      data: { active: false },
    });
    const key = `${subject.subjectType}:${subject.subjectId}:short:0`;
    const row = await waitFor(async () => {
      const r = await ledgerRow(migratorDb, key);
      return r?.status === "cancelled" ? r : null;
    });
    expect(row.status).toBe("cancelled");
    expect(await migratorDb.notification.count({ where: { dedupeKey: { startsWith: key } } })).toBe(
      0,
    );

    const subject2 = { subjectType: "task", subjectId: `w-${f.uniqueSuffix()}` };
    const second = await withTenantTx(DEPT_CS, (tx) =>
      subscribeReminders(tx, DEPT_CS, {
        subject: subject2,
        deadline: { everyDays: 1, whileInStates: ["in_progress"] },
        scheduleKey: "short",
        audienceSpec: { persons: [person.id] },
      }),
    );
    const k2 = second.materialized[0]!;
    const job = await migratorDb.scheduledJob.findUniqueOrThrow({ where: { idempotencyKey: k2 } });
    await boss.cancel("reminder.fire", job.pgBossJobId!);
    const data = {
      subscriptionId: second.subscription.id,
      idempotencyKey: k2,
      departmentId: DEPT_CS,
      offsetDays: 0,
      templateKey: "deadline_reminder",
      channels: ["in_app"],
      overdue: false,
      interval: true,
    };
    const id = await boss.send("reminder.fire", data);
    await awaitJob(boss, "reminder.fire", id!);
    expect((await ledgerRow(migratorDb, k2))?.status).toBe("cancelled");
    expect(
      (
        await migratorDb.reminderSubscription.findUniqueOrThrow({
          where: { id: second.subscription.id },
        })
      ).active,
    ).toBe(false);
  });

  it("the materialize cron picks up offsets entering the horizon", async () => {
    const subject = { subjectType: "task", subjectId: `m-${f.uniqueSuffix()}` };
    const person = await withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS));
    const { subscription, materialized } = await withTenantTx(DEPT_CS, (tx) =>
      subscribeReminders(tx, DEPT_CS, {
        subject,
        deadline: { at: new Date(Date.now() + 5 * DAY) },
        scheduleKey: "short",
        audienceSpec: { persons: [person.id] },
      }),
    );
    expect(materialized).toEqual([]);
    await migratorDb.reminderSubscription.update({
      where: { id: subscription.id },
      data: { resolvedDeadlineAt: new Date(Date.now() + 1.2 * DAY) },
    });
    const id = await boss.send("reminder.materialize", {});
    await awaitJob(boss, "reminder.materialize", id!);
    const rows = await migratorDb.scheduledJob.findMany({
      where: { subjectId: subject.subjectId },
    });
    expect(rows.map((r) => r.idempotencyKey).sort()).toEqual([
      `task:${subject.subjectId}:short:-1`,
      `task:${subject.subjectId}:short:0`,
    ]);
  });
});
