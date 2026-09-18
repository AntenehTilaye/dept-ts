import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import linear from "../fixtures/workflows/linear.json";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import type { Actor } from "@/platform/identity/can";
import { ledgerRow } from "@/platform/scheduler/ledger";
import { isRegistered, replace } from "@/platform/subject-registry";
import { apply, applyIn, start } from "@/platform/workflow/engine";
import { upsertDefinition } from "@/platform/workflow/registry";
import workflowAutoTransition from "../../apps/worker/src/handlers/workflow-auto-transition";
import { migratorDb, withDept } from "../setup/db";
import { DEPT_CS } from "../setup/seed-minimal";
import { uniqueSuffix } from "../setup/factories";
import { startTestBoss } from "../setup/boss";

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
  boss = await startTestBoss([workflowAutoTransition]);
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

const EXPIRE = {
  key: "in_progress.expire",
  from: "in_progress",
  to: "cancelled",
  action: "expire",
  system: true,
};
const SCHEDULE = {
  kind: "scheduleAutoTransition",
  args: { transitionKey: "in_progress.expire", afterHours: 0 },
};

describe("scheduleAutoTransition effect + workflow.auto_transition worker", () => {
  it("applies the system transition when due, and is a no-op when the state moved", async () => {
    const u = await migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } });
    const head: Actor = { userId: u.id, personId: null, departmentId: DEPT_CS, isAdmin: false };
    const key = `test.auto.${uniqueSuffix()}`;
    const transitions = [
      ...linear.transitions.map((t) =>
        t.key === "draft.start" ? { ...t, effects: [SCHEDULE] } : t,
      ),
      EXPIRE,
    ];
    await upsertDefinition({ ...linear, key, departmentId: DEPT_CS, transitions });

    const a = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: key,
        subject: { subjectType: "task", subjectId: `a-${uniqueSuffix()}` },
        departmentId: DEPT_CS,
        actor: head,
      }),
    );
    await apply(DEPT_CS, a.id, "draft.start", head);
    const ledgerA = await migratorDb.scheduledJob.findFirst({
      where: { subjectId: a.subjectId, kind: "auto_transition" },
    });
    expect(ledgerA?.idempotencyKey.startsWith(`wf:${a.id}:in_progress.expire:`)).toBe(true);
    const doneA = await waitFor(async () => {
      const i = await migratorDb.workflowInstance.findUniqueOrThrow({ where: { id: a.id } });
      return i.currentState === "cancelled" ? i : null;
    });
    expect(doneA.currentState).toBe("cancelled");
    expect((await ledgerRow(migratorDb, ledgerA!.idempotencyKey))?.status).toBe("done");

    const b = await withDept(DEPT_CS, (tx) =>
      start(tx, {
        definitionKey: key,
        subject: { subjectType: "task", subjectId: `b-${uniqueSuffix()}` },
        departmentId: DEPT_CS,
        actor: head,
      }),
    );
    await withTenantTx(DEPT_CS, async (tx) => {
      await applyIn(tx, b.id, "draft.start", head);
      await applyIn(tx, b.id, "in_progress.submit", head, { fields: { summary: "quick" } });
    });
    const ledgerB = await migratorDb.scheduledJob.findFirst({
      where: { subjectId: b.subjectId, kind: "auto_transition" },
    });
    const cancelled = await waitFor(async () => {
      const r = await ledgerRow(migratorDb, ledgerB!.idempotencyKey);
      return r?.status === "cancelled" ? r : null;
    });
    expect(cancelled.lastError).toBe("state moved");
    expect(
      (await migratorDb.workflowInstance.findUniqueOrThrow({ where: { id: b.id } })).currentState,
    ).toBe("review");
  });
});
