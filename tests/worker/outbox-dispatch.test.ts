import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "@/lib/db/tenant";
import { publish, subscribe, unsubscribe } from "@/platform/audit/outbox";
import outboxDispatch from "../../apps/worker/src/handlers/outbox-dispatch";
import { migratorDb } from "../setup/db";
import { DEPT_CS } from "../setup/seed-minimal";
import { uniqueSuffix } from "../setup/factories";
import { awaitJob, startTestBoss } from "../setup/boss";

let boss: PgBoss;
beforeAll(async () => {
  boss = await startTestBoss([outboxDispatch]);
});
afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
});

describe("outbox.dispatch worker", () => {
  it("drains published events, runs each subscriber once, and keeps one queued job under policy short", async () => {
    const name = `w.event.${uniqueSuffix()}`;
    const seen: string[] = [];
    subscribe(name, "spy", async (e) => {
      seen.push(e.aggregateId);
    });
    try {
      await withTenantTx(DEPT_CS, async (tx) => {
        await publish(tx, name, { subjectType: "task", subjectId: "a" });
        await publish(tx, name, { subjectType: "task", subjectId: "b" });
      });
      const [j1, j2] = await Promise.all([
        boss.send("outbox.dispatch", {}),
        boss.send("outbox.dispatch", {}),
      ]);
      expect([j1, j2].filter(Boolean)).toHaveLength(1); // the second send is dropped by the queue policy
      await awaitJob(boss, "outbox.dispatch", (j1 ?? j2)!);
      // the handler chains itself; wait until both events are published
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const pending = await migratorDb.domainEvent.count({ where: { name, publishedAt: null } });
        if (pending === 0) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(seen.sort()).toEqual(["a", "b"]);
      const receipts = await migratorDb.eventHandlerReceipt.findMany({
        where: { handlerKey: "spy", event: { name } },
      });
      expect(receipts).toHaveLength(2);
      // a replayed dead event: clearing deadAt lets the dispatcher pick it up again
      const dead = await migratorDb.domainEvent.create({
        data: {
          departmentId: DEPT_CS,
          name,
          aggregateType: "task",
          aggregateId: "dead",
          payloadJson: {},
          attempts: 10,
          deadAt: new Date(),
        },
      });
      await migratorDb.domainEvent.update({
        where: { id: dead.id },
        data: { deadAt: null, attempts: 0 },
      });
      const j3 = await boss.send("outbox.dispatch", {});
      const until = Date.now() + 15_000;
      while (
        Date.now() < until &&
        !(await migratorDb.domainEvent.findUniqueOrThrow({ where: { id: dead.id } })).publishedAt
      )
        await new Promise((r) => setTimeout(r, 250));
      expect(
        (await migratorDb.domainEvent.findUniqueOrThrow({ where: { id: dead.id } })).publishedAt,
      ).toBeInstanceOf(Date);
      expect(j3 === null || typeof j3 === "string").toBe(true);
    } finally {
      unsubscribe(name);
    }
  });
});
