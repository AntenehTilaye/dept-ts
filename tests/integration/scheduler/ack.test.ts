import { describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import {
  acknowledge,
  ackStatus,
  decline,
  inbox,
  markRead,
  unreadCount,
} from "@/platform/scheduler/inbox";
import { enabledChannels, MassSendError, notify } from "@/platform/scheduler/notify";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

describe("notifications: dedupe, channels, ack and decline", () => {
  it("notify is idempotent on the dedupe key, creates deliveries per enabled channel and respects preferences", async () => {
    const user = await migratorDb.user.findUniqueOrThrow({
      where: { email: "instructor1.cs@deptts.local" },
    });
    const { withLogin, noLogin, noEmail } = await withDept(DEPT_CS, async (tx) => ({
      withLogin: await f.staff(tx, DEPT_CS, {
        userId: user.id,
        email: "instructor1.cs@deptts.local",
      }),
      noLogin: await f.staff(tx, DEPT_CS),
      noEmail: await f.staff(tx, DEPT_CS, { email: null }),
    }));
    await migratorDb.channelPreference.create({
      data: { userId: user.id, category: "announcement", channel: "email", enabled: false },
    });
    expect(await enabledChannels(migratorDb, user.id, "announcement", ["in_app", "email"])).toEqual(
      ["in_app"],
    );
    expect(await enabledChannels(migratorDb, user.id, "workflow", ["in_app", "email"])).toEqual([
      "in_app",
      "email",
    ]);
    expect(await enabledChannels(migratorDb, null, "workflow", ["in_app", "email"])).toEqual([
      "email",
    ]);

    const key = `t:${f.uniqueSuffix()}`;
    const first = await withDept(DEPT_CS, (tx) =>
      notify(tx, DEPT_CS, {
        recipients: [withLogin.id, noLogin.id, noEmail.id],
        category: "announcement",
        title: "Hello",
        body: "World",
        dedupeKey: key,
        ackRequired: true,
      }),
    );
    expect(first.created).toHaveLength(3);
    const again = await withDept(DEPT_CS, (tx) =>
      notify(tx, DEPT_CS, {
        recipients: [withLogin.id],
        category: "announcement",
        title: "Hello",
        body: "World",
        dedupeKey: key,
      }),
    );
    expect(again.created).toEqual([]);
    expect(again.existing).toHaveLength(1);
    const deliveries = await migratorDb.notificationDelivery.findMany({
      where: { notification: { dedupeKey: { startsWith: key } } },
      include: { notification: true },
    });
    const byPerson = (id: string) =>
      deliveries
        .filter((d) => d.notification.recipientPersonId === id)
        .map((d) => d.channel)
        .sort();
    expect(byPerson(withLogin.id)).toEqual(["in_app"]); // email disabled for announcements
    expect(byPerson(noLogin.id)).toEqual(["email"]); // no login: email only
    expect(byPerson(noEmail.id)).toEqual([]); // no login and no address: nothing to deliver
    expect(
      await migratorDb.scheduledJob.count({
        where: { queue: "notification.deliver", subjectId: { in: first.created } },
      }),
    ).toBe(0); // no idempotency key = no ledger row
  });

  it("acknowledge sets acknowledgedAt once, decline records the reason and publishes, ackStatus aggregates", async () => {
    const [a, b] = await withDept(DEPT_CS, async (tx) => [
      await f.staff(tx, DEPT_CS),
      await f.staff(tx, DEPT_CS),
    ]);
    const subject = { subjectType: "resource", subjectId: `duty-${f.uniqueSuffix()}` };
    await withDept(DEPT_CS, (tx) =>
      notify(tx, DEPT_CS, {
        recipients: [a!.id, b!.id],
        category: "invigilation",
        title: "Duty",
        body: "Please confirm",
        dedupeKey: `d:${subject.subjectId}`,
        ackRequired: true,
        declinable: true,
        subject,
        channels: ["in_app"],
      }),
    );
    const inboxA = await withDept(DEPT_CS, (tx) => inbox(tx, a!.id, { ackRequiredOnly: true }));
    expect(inboxA).toHaveLength(1);
    expect(await withDept(DEPT_CS, (tx) => unreadCount(tx, a!.id))).toEqual({
      unread: 1,
      pendingAck: 1,
    });
    const ack1 = await withDept(DEPT_CS, (tx) => acknowledge(tx, a!.id, inboxA[0]!.id));
    const ack2 = await withDept(DEPT_CS, (tx) => acknowledge(tx, a!.id, inboxA[0]!.id));
    expect(ack1.acknowledgedAt).toEqual(ack2.acknowledgedAt);
    await expect(withDept(DEPT_CS, (tx) => acknowledge(tx, b!.id, inboxA[0]!.id))).rejects.toThrow(
      /Not the recipient/,
    );
    const inboxB = await withDept(DEPT_CS, (tx) => inbox(tx, b!.id));
    const declined = await withDept(DEPT_CS, (tx) =>
      decline(tx, b!.id, inboxB[0]!.id, "  travelling  "),
    );
    expect(declined.declineReason).toBe("travelling");
    expect(
      await migratorDb.domainEvent.count({
        where: { name: "notification.declined", aggregateId: subject.subjectId },
      }),
    ).toBe(1);
    const status = await withDept(DEPT_CS, (tx) => ackStatus(tx, subject));
    expect(status).toMatchObject({ total: 2, acknowledged: 1, declined: 1, pending: 0 });
    expect(await withDept(DEPT_CS, (tx) => markRead(tx, a!.id, [inboxA[0]!.id]))).toBe(0);
    expect(await withDept(DEPT_CS, (tx) => unreadCount(tx, a!.id))).toEqual({
      unread: 0,
      pendingAck: 0,
    });
  });

  it("notifications are RLS-isolated between departments and the mass-send threshold guards fan-out", async () => {
    const p = await withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS));
    await withDept(DEPT_CS, (tx) =>
      notify(tx, DEPT_CS, {
        recipients: [p.id],
        category: "workflow",
        title: "x",
        body: "y",
        dedupeKey: `iso:${f.uniqueSuffix()}`,
        channels: ["in_app"],
      }),
    );
    expect(
      await withDept(DEPT_EE, (tx) =>
        tx.notification.count({ where: { recipientPersonId: p.id } }),
      ),
    ).toBe(0);
    await migratorDb.systemSetting.update({
      where: {
        key_scope_scopeId: { key: "notify.massSendThreshold", scope: "global", scopeId: "" },
      },
      data: { valueJson: 0 },
    });
    try {
      await expect(
        withDept(DEPT_CS, (tx) =>
          notify(tx, DEPT_CS, {
            recipients: [p.id],
            category: "workflow",
            title: "x",
            body: "y",
            dedupeKey: `mass:${f.uniqueSuffix()}`,
          }),
        ),
      ).rejects.toThrow(MassSendError);
      const ok = await withDept(DEPT_CS, (tx) =>
        notify(tx, DEPT_CS, {
          recipients: [p.id],
          category: "workflow",
          title: "x",
          body: "y",
          dedupeKey: `mass2:${f.uniqueSuffix()}`,
          confirmMassSend: true,
          channels: ["in_app"],
        }),
      );
      expect(ok.created).toHaveLength(1);
    } finally {
      await migratorDb.systemSetting.update({
        where: {
          key_scope_scopeId: { key: "notify.massSendThreshold", scope: "global", scopeId: "" },
        },
        data: { valueJson: 200 },
      });
    }
  });
});
