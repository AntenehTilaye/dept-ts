import { describe, expect, it } from "vitest";
import { withTenantTx } from "@/lib/db/tenant";
import { publish } from "@/platform/audit/outbox";
import { migratorDb, rawClient } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";

describe("append-only tables and the column-guarded outbox (as dept_app)", () => {
  it("rejects UPDATE/DELETE on audit_event, workflow_transition_log and event_handler_receipt", async () => {
    const c = await rawClient("app");
    try {
      for (const table of ["audit_event", "workflow_transition_log", "event_handler_receipt"]) {
        await expect(
          c.query(
            `UPDATE ${table} SET ${table === "event_handler_receipt" ? "error" : table === "audit_event" ? "reason" : "comment"} = 'x'`,
          ),
        ).rejects.toThrow(/permission denied|append-only/);
        await expect(c.query(`DELETE FROM ${table}`)).rejects.toThrow(
          /permission denied|append-only/,
        );
      }
    } finally {
      await c.end();
    }
  });

  it("allows only the delivery columns of domain_event to change and deletes only published rows", async () => {
    const e = await withTenantTx(DEPT_CS, (tx) =>
      publish(tx, "test.guard", { subjectType: "task", subjectId: "g1" }, { a: 1 }),
    );
    const c = await rawClient("app");
    try {
      await c.query(`SELECT set_config('app.tenant_bypass', 'on', false)`);
      await expect(
        c.query(`UPDATE domain_event SET payload_json = '{}' WHERE id = $1`, [e.id]),
      ).rejects.toThrow(/permission denied|delivery columns/);
      await expect(
        c.query(`UPDATE domain_event SET name = 'renamed' WHERE id = $1`, [e.id]),
      ).rejects.toThrow(/permission denied|delivery columns/);
      await c.query(
        `UPDATE domain_event SET attempts = attempts + 1, last_error = 'x' WHERE id = $1`,
        [e.id],
      );
      await expect(c.query(`DELETE FROM domain_event WHERE id = $1`, [e.id])).rejects.toThrow(
        /unpublished/,
      );
      await c.query(`UPDATE domain_event SET published_at = now() WHERE id = $1`, [e.id]);
      await c.query(`DELETE FROM domain_event WHERE id = $1`, [e.id]);
      expect(await migratorDb.domainEvent.findUnique({ where: { id: e.id } })).toBeNull();
    } finally {
      await c.end();
    }
  });

  it("purge_domain_events removes only published rows older than the cut-off", async () => {
    // the guard trigger forbids editing occurred_at, so the old event is inserted as such
    const old = await migratorDb.domainEvent.create({
      data: {
        departmentId: DEPT_CS,
        name: "test.purge",
        aggregateType: "task",
        aggregateId: "old",
        payloadJson: {},
        occurredAt: new Date(Date.now() - 40 * 86_400_000),
        publishedAt: new Date(),
      },
    });
    const fresh = await withTenantTx(DEPT_CS, (tx) =>
      publish(tx, "test.purge", { subjectType: "task", subjectId: "fresh" }),
    );
    await migratorDb.$executeRaw`UPDATE domain_event SET published_at = now() WHERE id = ${fresh.id}`;
    const c = await rawClient("app");
    try {
      await c.query(`SELECT set_config('app.tenant_bypass', 'on', false)`);
      const { rows } = await c.query<{ n: number }>(
        `SELECT purge_domain_events(now() - interval '30 days') AS n`,
      );
      expect(rows[0]!.n).toBeGreaterThanOrEqual(1);
    } finally {
      await c.end();
    }
    expect(await migratorDb.domainEvent.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await migratorDb.domainEvent.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });
});
