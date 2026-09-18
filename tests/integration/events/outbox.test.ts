import { afterEach, describe, expect, it, vi } from "vitest";
import { withTenantTx } from "@/lib/db/tenant";
import {
  dispatchPending,
  MAX_ATTEMPTS,
  pendingCount,
  publish,
  subscribe,
  unsubscribe,
} from "@/platform/audit/outbox";
import { migratorDb } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import { uniqueSuffix } from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });

describe("transactional outbox", () => {
  const name = `test.event.${uniqueSuffix()}`;
  afterEach(() => unsubscribe(name));

  it("publish inside a rolled-back transaction leaves no event", async () => {
    await expect(
      withTenantTx(DEPT_CS, async (tx) => {
        await publish(tx, name, { subjectType: "task", subjectId: "rolled" }, { x: 1 });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await migratorDb.domainEvent.count({ where: { name, aggregateId: "rolled" } })).toBe(0);
  });

  it("runs every subscriber once, retries a throwing subscriber without re-running the succeeded one, and gives up after MAX_ATTEMPTS", async () => {
    const calls = { ok: 0, bad: 0 };
    let failUntil = 2;
    subscribe(name, "ok", async () => {
      calls.ok++;
    });
    subscribe(name, "bad", async () => {
      calls.bad++;
      if (calls.bad <= failUntil) throw new Error(`bad attempt ${calls.bad}`);
    });
    const event = await withTenantTx(DEPT_CS, (tx) =>
      publish(tx, name, { subjectType: "task", subjectId: "e1" }, { hello: "world" }),
    );
    expect(await pendingCount()).toBeGreaterThanOrEqual(1);

    const first = await dispatchPending(100);
    expect(first.failed).toBeGreaterThanOrEqual(1);
    let row = await migratorDb.domainEvent.findUniqueOrThrow({
      where: { id: event.id },
      include: { receipts: true },
    });
    expect(row.publishedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/bad attempt 1/);
    expect(row.receipts.map((r) => r.handlerKey)).toEqual(["ok"]);

    await dispatchPending(100); // second failure
    await dispatchPending(100); // third try succeeds
    row = await migratorDb.domainEvent.findUniqueOrThrow({
      where: { id: event.id },
      include: { receipts: true },
    });
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(row.receipts.map((r) => r.handlerKey).sort()).toEqual(["bad", "ok"]);
    expect(calls).toEqual({ ok: 1, bad: 3 });

    // an always-failing subscriber reaches deadAt after MAX_ATTEMPTS
    failUntil = Infinity;
    const doomed = await withTenantTx(DEPT_CS, (tx) =>
      publish(tx, name, { subjectType: "task", subjectId: "e2" }),
    );
    for (let i = 0; i < MAX_ATTEMPTS; i++) await dispatchPending(100);
    const dead = await migratorDb.domainEvent.findUniqueOrThrow({ where: { id: doomed.id } });
    expect(dead.deadAt).toBeInstanceOf(Date);
    expect(dead.attempts).toBe(MAX_ATTEMPTS);
    const again = await dispatchPending(100);
    expect(again.picked).toBe(0);
  });

  it("subscribers receive the event row with its department and payload", async () => {
    let seen: unknown;
    subscribe(name, "spy", async (e) => {
      seen = {
        departmentId: e.departmentId,
        payload: e.payloadJson,
        aggregate: `${e.aggregateType}:${e.aggregateId}`,
      };
    });
    await withTenantTx(DEPT_CS, (tx) =>
      publish(tx, name, { subjectType: "person", subjectId: "p9" }, { k: 1 }),
    );
    await dispatchPending(100);
    expect(seen).toEqual({ departmentId: DEPT_CS, payload: { k: 1 }, aggregate: "person:p9" });
  });
});
