import { describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { setPeriod } from "@/platform/academic/calendar";
import { dispatchPending } from "@/platform/audit/outbox";
import { dryRun, ledgerRow } from "@/platform/scheduler/ledger";
import {
  cancelBySubject,
  dependentsOfPeriod,
  materializeSubscription,
  rescheduleAnchored,
  subscribeReminders,
} from "@/platform/scheduler/reminders";
import { upcoming } from "@/platform/scheduler/upcoming";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

const DAY = 86_400_000;

describe("reminder subscriptions", () => {
  it("subscribeReminders writes the subscription and materialises the in-horizon offsets in the same transaction (rollback leaves nothing)", async () => {
    const subject = { subjectType: "task", subjectId: `s-${f.uniqueSuffix()}` };
    const now = new Date();
    const deadline = new Date(now.getTime() + 1.5 * DAY); // -1 (in 12 h) and 0 (in 36 h) inside 48 h; -3/-7 in the past; +1 in 60 h
    await expect(
      withTenantTx(DEPT_CS, async (tx) => {
        await subscribeReminders(tx, DEPT_CS, {
          subject,
          deadline: { at: deadline },
          scheduleKey: "default_7_3_1_0_overdue",
          audienceSpec: { roles: ["department_head"] },
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(
      await migratorDb.reminderSubscription.count({ where: { subjectId: subject.subjectId } }),
    ).toBe(0);
    expect(await migratorDb.scheduledJob.count({ where: { subjectId: subject.subjectId } })).toBe(
      0,
    );

    const { subscription, materialized } = await withTenantTx(DEPT_CS, (tx) =>
      subscribeReminders(tx, DEPT_CS, {
        subject,
        deadline: { at: deadline },
        scheduleKey: "default_7_3_1_0_overdue",
        audienceSpec: { roles: ["department_head"] },
        variables: { title: "Task S" },
      }),
    );
    expect(subscription.resolvedDeadlineAt).toEqual(deadline);
    expect(materialized.sort()).toEqual([
      `${subject.subjectType}:${subject.subjectId}:default_7_3_1_0_overdue:-1`,
      `${subject.subjectType}:${subject.subjectId}:default_7_3_1_0_overdue:0`,
    ]);
    const rows = await migratorDb.scheduledJob.findMany({
      where: { subjectId: subject.subjectId },
      orderBy: { runAt: "asc" },
    });
    expect(rows.map((r) => r.status)).toEqual(["scheduled", "scheduled"]);
    expect(rows.every((r) => r.pgBossJobId)).toBe(true);
    // re-materialising is a no-op; widening the horizon adds the later offsets
    expect(
      await withTenantTx(DEPT_CS, (tx) => materializeSubscription(tx, subscription.id)),
    ).toEqual([]);
    const more = await withTenantTx(DEPT_CS, (tx) =>
      materializeSubscription(tx, subscription.id, now, 24 * 10),
    );
    expect(more.length).toBe(2); // +1 and the escalation (+3)
    const dry = await withDept(DEPT_CS, (tx) =>
      dryRun(tx, DEPT_CS, now, new Date(now.getTime() + 10 * DAY)),
    );
    expect(dry.filter((d) => d.subjectId === subject.subjectId)).toHaveLength(4);
    const up = await withDept(DEPT_CS, (tx) =>
      upcoming(tx, DEPT_CS, { from: now, to: new Date(now.getTime() + 5 * DAY) }),
    );
    expect(up.find((u) => u.subjectId === subject.subjectId)).toMatchObject({
      scheduleKey: "default_7_3_1_0_overdue",
      variables: { title: "Task S" },
    });
    const head = await migratorDb.person
      .findFirstOrThrow({ where: { email: "dh.cs@deptts.local" } })
      .catch(() => null);
    if (head) {
      const mine = await withDept(DEPT_CS, (tx) =>
        upcoming(tx, DEPT_CS, {
          personId: head.id,
          from: now,
          to: new Date(now.getTime() + 5 * DAY),
        }),
      );
      expect(mine.some((u) => u.subjectId === subject.subjectId)).toBe(true);
    }
    // cancel by subject expires the subscription and cancels the ledger rows
    expect(await withTenantTx(DEPT_CS, (tx) => cancelBySubject(tx, subject))).toBe(4);
    expect((await ledgerRow(migratorDb, rows[0]!.idempotencyKey))?.status).toBe("cancelled");
    expect(
      (await migratorDb.reminderSubscription.findUniqueOrThrow({ where: { id: subscription.id } }))
        .active,
    ).toBe(false);
  });

  it("a moved calendar period re-anchors subscriptions through the outbox subscriber", async () => {
    const subject = { subjectType: "task", subjectId: `a-${f.uniqueSuffix()}` };
    const { term, period } = await withDept(DEPT_CS, async (tx) => {
      const term = await f.currentTermOf(tx, DEPT_CS);
      const period = await tx.calendarPeriod.findFirstOrThrow({
        where: { termId: term.id, kind: "evaluation" },
      });
      return { term, period };
    });
    const { subscription } = await withTenantTx(DEPT_CS, (tx) =>
      subscribeReminders(tx, DEPT_CS, {
        subject,
        deadline: {
          anchor: { periodKind: "evaluation", edge: "end", offsetDays: 0, termId: term.id },
        },
        scheduleKey: "short",
        audienceSpec: { roles: ["department_head"] },
      }),
    );
    expect(subscription.resolvedDeadlineAt).toEqual(period.endAt);
    const deps = await withDept(DEPT_CS, (tx) => dependentsOfPeriod(tx, period.id));
    expect(deps.map((d) => d.id)).toContain(subscription.id);
    const newEnd = new Date(period.endAt.getTime() + 2 * DAY);
    const { dependents } = await withTenantTx(DEPT_CS, (tx) =>
      setPeriod(tx, DEPT_CS, {
        id: period.id,
        termId: term.id,
        kind: "evaluation",
        label: period.label,
        startAt: period.startAt,
        endAt: newEnd,
      }),
    );
    expect(dependents.map((d) => d.id)).toContain(subscription.id);
    await dispatchPending(100);
    const after = await migratorDb.reminderSubscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    expect(after.resolvedDeadlineAt).toEqual(newEnd);
    // direct call is idempotent once re-anchored
    expect(
      await withTenantTx(DEPT_CS, (tx) => rescheduleAnchored(tx, DEPT_CS, term.id, "evaluation")),
    ).toEqual([]);
    await withTenantTx(DEPT_CS, (tx) =>
      setPeriod(tx, DEPT_CS, {
        id: period.id,
        termId: term.id,
        kind: "evaluation",
        label: period.label,
        startAt: period.startAt,
        endAt: period.endAt,
      }),
    );
  });

  it("interval subscriptions materialise the next nudge and unknown schedule keys are rejected", async () => {
    const subject = { subjectType: "task", subjectId: `i-${f.uniqueSuffix()}` };
    await expect(
      withTenantTx(DEPT_CS, (tx) =>
        subscribeReminders(tx, DEPT_CS, {
          subject,
          deadline: { at: new Date() },
          scheduleKey: "nope",
          audienceSpec: {},
        }),
      ),
    ).rejects.toThrow(/not seeded/);
    const { subscription, materialized } = await withTenantTx(DEPT_CS, (tx) =>
      subscribeReminders(tx, DEPT_CS, {
        subject,
        deadline: { everyDays: 1, whileInStates: ["in_progress"] },
        scheduleKey: "short",
        audienceSpec: { persons: [] },
      }),
    );
    expect(subscription.kind).toBe("interval");
    expect(materialized).toHaveLength(1);
    const row = await ledgerRow(migratorDb, materialized[0]!);
    expect(row?.kind).toBe("interval_nudge");
    expect(row!.runAt.getTime() - subscription.createdAt.getTime()).toBe(DAY);
  });
});
