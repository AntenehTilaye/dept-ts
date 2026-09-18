import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "@/lib/db/tenant";
import { enqueue } from "@/platform/scheduler/enqueue";
import { cancelByPrefix, ledgerRow } from "@/platform/scheduler/ledger";
import { migratorDb } from "../setup/db";
import { DEPT_CS } from "../setup/seed-minimal";
import { uniqueSuffix } from "../setup/factories";
import { startTestBoss } from "../setup/boss";

let boss: PgBoss;
beforeAll(async () => {
  boss = await startTestBoss([]);
});
afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
});

describe("enqueue on the Prisma transaction connection", () => {
  it("a rolled-back transaction leaves no pg-boss job and no ledger row", async () => {
    const key = `tx:${uniqueSuffix()}`;
    let jobId: string | null = null;
    await expect(
      withTenantTx(DEPT_CS, async (tx) => {
        const r = await enqueue(
          tx,
          "reminder.fire",
          { probe: true },
          { kind: "reminder", idempotencyKey: key, singletonKey: key, departmentId: DEPT_CS },
        );
        jobId = r.jobId;
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(jobId).toBeTruthy();
    expect(await boss.getJobById("reminder.fire", jobId!)).toBeNull();
    expect(await ledgerRow(migratorDb, key)).toBeNull();
  });

  it("a committed transaction produces exactly one job with the singleton key and one ledger row; duplicates are no-ops", async () => {
    const key = `tx:${uniqueSuffix()}`;
    const runAt = new Date(Date.now() + 3_600_000);
    const first = await withTenantTx(DEPT_CS, (tx) =>
      enqueue(
        tx,
        "reminder.fire",
        { probe: true },
        {
          kind: "reminder",
          idempotencyKey: key,
          singletonKey: key,
          startAfter: runAt,
          departmentId: DEPT_CS,
          subjectType: "task",
          subjectId: "t1",
        },
      ),
    );
    expect(first.duplicate).toBe(false);
    const job = await boss.getJobById("reminder.fire", first.jobId!);
    expect(job).toMatchObject({ state: "created", singletonKey: key });
    const row = await ledgerRow(migratorDb, key);
    expect(row).toMatchObject({
      status: "scheduled",
      pgBossJobId: first.jobId,
      queue: "reminder.fire",
      subjectType: "task",
      subjectId: "t1",
      departmentId: DEPT_CS,
    });
    expect(row?.runAt.getTime()).toBe(runAt.getTime());
    const second = await withTenantTx(DEPT_CS, (tx) =>
      enqueue(
        tx,
        "reminder.fire",
        { probe: true },
        { kind: "reminder", idempotencyKey: key, singletonKey: key, departmentId: DEPT_CS },
      ),
    );
    expect(second).toMatchObject({ duplicate: true, jobId: first.jobId });
    process.env.PGBOSS_SCHEMA_KEEP = "1";
    const cancelled = await withTenantTx(DEPT_CS, (tx) =>
      cancelByPrefix(tx, "tx:", { bossCancel: false }),
    );
    expect(cancelled).toBeGreaterThanOrEqual(1);
    expect((await ledgerRow(migratorDb, key))?.status).toBe("cancelled");
    // a cancelled key can be enqueued again
    const third = await withTenantTx(DEPT_CS, (tx) =>
      enqueue(
        tx,
        "reminder.fire",
        { probe: true },
        { kind: "reminder", idempotencyKey: key, departmentId: DEPT_CS },
      ),
    );
    expect(third.duplicate).toBe(false);
  });
});
