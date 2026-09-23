import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import type { Actor } from "@/platform/identity/can";
import { createTask } from "@/platform/workitem";
import recurrenceSpawn from "../../apps/worker/src/handlers/recurrence-spawn";
import { migratorDb, withDept } from "../setup/db";
import { DEPT_CS } from "../setup/seed-minimal";
import * as f from "../setup/factories";
import { awaitJob, startTestBoss } from "../setup/boss";

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

let boss: PgBoss;
let head: Actor;
let assigneePersonId: string;

beforeAll(async () => {
  boss = await startTestBoss([recurrenceSpawn]);
  const user = await migratorDb.user.findUniqueOrThrow({
    where: { email: "dh.cs@deptts.local" },
  });
  const [p1, p2] = await Promise.all([
    withDept(DEPT_CS, (tx) =>
      f.staff(tx, DEPT_CS, { userId: user.id, email: "dh.cs@deptts.local" }),
    ),
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
  ]);
  assigneePersonId = p2.id;
  head = { userId: user.id, personId: p1.id, departmentId: DEPT_CS, isAdmin: false };
});
afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
});

const DAY = 86_400_000;

describe("recurrence.spawn", () => {
  it("spawns the next occurrence exactly once and advances nextSpawnAt", async () => {
    const startsOn = new Date(Date.now() - 2 * DAY);
    const template = await withTenantTx(DEPT_CS, (tx) =>
      createTask(tx, head, {
        title: "Weekly lab safety check",
        kind: "department_task",
        assignees: [{ type: "person", id: assigneePersonId }],
        dueAt: startsOn,
        recurrence: {
          frequency: "daily",
          interval: 1,
          byWeekday: [],
          startsOn,
          timezone: "Africa/Addis_Ababa",
        },
      }),
    );
    const rule = await migratorDb.recurrenceRule.findFirstOrThrow({
      where: { templateTaskId: template.id },
    });
    expect(rule.nextSpawnAt).not.toBeNull();
    const due = rule.nextSpawnAt!;
    expect(due.getTime()).toBeLessThan(Date.now()); // the occurrence is already due

    const before = await migratorDb.task.count({
      where: { departmentId: DEPT_CS, title: "Weekly lab safety check" },
    });
    const id = await boss.send("recurrence.spawn", {});
    await awaitJob(boss, "recurrence.spawn", id!);
    const after = await migratorDb.task.count({
      where: { departmentId: DEPT_CS, title: "Weekly lab safety check" },
    });
    expect(after).toBe(before + 1);

    const spawned = await migratorDb.task.findFirstOrThrow({
      where: { departmentId: DEPT_CS, title: "Weekly lab safety check", id: { not: template.id } },
      include: { assignments: true },
    });
    expect(spawned.dueAt?.getTime()).toBe(due.getTime());
    expect(spawned.assignments.map((a) => a.assigneeId)).toEqual([assigneePersonId]);

    const advanced = await migratorDb.recurrenceRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(advanced.spawnedCount).toBe(1);
    expect(advanced.nextSpawnAt!.getTime()).toBe(due.getTime() + DAY);
    // the ledger holds the claim that makes a second run a no-op
    expect(
      await migratorDb.scheduledJob.findUnique({
        where: { idempotencyKey: `recurrence:${rule.id}:${due.toISOString()}` },
      }),
    ).not.toBeNull();

    // running the same due occurrence again creates nothing (the ledger key is taken).
    // The handler is called directly: the queue policy is "short", so a second send while a
    // job is still queued is dropped rather than run.
    await migratorDb.recurrenceRule.update({
      where: { id: rule.id },
      data: { nextSpawnAt: due, spawnedCount: 0 },
    });
    await recurrenceSpawn.handle([], { boss });
    expect(
      await migratorDb.task.count({
        where: { departmentId: DEPT_CS, title: "Weekly lab safety check" },
      }),
    ).toBe(after);
  });

  it("stops spawning once the rule has ended", async () => {
    const startsOn = new Date(Date.now() - 3 * DAY);
    const template = await withTenantTx(DEPT_CS, (tx) =>
      createTask(tx, head, {
        title: "Finite series",
        assignees: [{ type: "person", id: assigneePersonId }],
        dueAt: startsOn,
        recurrence: {
          frequency: "daily",
          interval: 1,
          byWeekday: [],
          startsOn,
          endsOn: new Date(Date.now() - 2 * DAY),
          timezone: "Africa/Addis_Ababa",
        },
      }),
    );
    const rule = await migratorDb.recurrenceRule.findFirstOrThrow({
      where: { templateTaskId: template.id },
    });
    await recurrenceSpawn.handle([], { boss });
    const after = await migratorDb.recurrenceRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(after.nextSpawnAt).toBeNull();
    expect(
      await migratorDb.task.count({ where: { departmentId: DEPT_CS, title: "Finite series" } }),
    ).toBe(2);
  });
});
