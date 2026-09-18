import { describe, expect, it, vi } from "vitest";
import { runWithAudit } from "@/platform/audit/context";
import { history } from "@/platform/audit/history";
import { record } from "@/platform/audit/record";
import { withTenantBypass, withTenantTx } from "@/lib/db/tenant";
import { bootstrap } from "@/lib/bootstrap";
import { updatePerson } from "@/platform/people/persons";
import { migratorDb, rawClient, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });
bootstrap();

describe("audit interceptor", () => {
  it("records before/after values with the actor and correlation id of the ambient context", async () => {
    const p = await withDept(DEPT_CS, (tx) => f.person(tx, DEPT_CS, { fullName: "Before Name" }));
    await runWithAudit({ actorUserId: "user-1", correlationId: "corr-1" }, () =>
      withTenantTx(DEPT_CS, (tx) =>
        updatePerson(tx, p.id, { fullName: "After Name", phone: "+1" }),
      ),
    );
    const rows = await migratorDb.auditEvent.findMany({
      where: { subjectType: "person", subjectId: p.id },
      orderBy: { at: "asc" },
    });
    const update = rows.find((r) => r.action === "update")!;
    expect(update).toMatchObject({
      actorUserId: "user-1",
      correlationId: "corr-1",
      departmentId: DEPT_CS,
    });
    expect(update.fieldChangesJson).toEqual({
      fullName: { before: "Before Name", after: "After Name" },
      phone: { before: null, after: "+1" },
    });
    expect(rows.find((r) => r.action === "create")).toBeTruthy();
    const timeline = await withDept(DEPT_CS, (tx) =>
      history(tx, { subjectType: "person", subjectId: p.id }),
    );
    expect(timeline[0]).toMatchObject({ kind: "audit", action: "update" });
  });

  it("a delete records the before image and an anonymous write records no actor", async () => {
    const p = await withDept(DEPT_CS, (tx) => f.person(tx, DEPT_CS));
    const item = await withDept(DEPT_CS, (tx) =>
      tx.profileItem.create({
        data: { departmentId: DEPT_CS, personId: p.id, kind: "training", title: "T" },
      }),
    );
    await withDept(DEPT_CS, (tx) => tx.profileItem.delete({ where: { id: item.id } }));
    const del = await migratorDb.auditEvent.findFirst({
      where: { subjectType: "person", subjectId: p.id, action: "delete" },
    });
    expect(del?.actorUserId).toBeNull();
    expect((del?.fieldChangesJson as Record<string, { before: unknown }>).title?.before).toBe("T");
    // updateMany / deleteMany / createMany are covered too
    await withDept(DEPT_CS, (tx) =>
      tx.profileItem.createMany({
        data: [
          { departmentId: DEPT_CS, personId: p.id, kind: "training", title: "A" },
          { departmentId: DEPT_CS, personId: p.id, kind: "training", title: "B" },
        ],
      }),
    );
    await withDept(DEPT_CS, (tx) =>
      tx.profileItem.updateMany({ where: { personId: p.id }, data: { title: "Z" } }),
    );
    await withDept(DEPT_CS, (tx) => tx.profileItem.deleteMany({ where: { personId: p.id } }));
    const counts = await migratorDb.auditEvent.groupBy({
      by: ["action"],
      where: { subjectType: "person", subjectId: p.id },
      _count: { _all: true },
    });
    const byAction = Object.fromEntries(counts.map((c) => [c.action, c._count._all]));
    expect(byAction).toMatchObject({ create: 5, update: 2, delete: 3 });
  });

  it("writes on global tables outside a department transaction land as faculty-level rows", async () => {
    const setting = await migratorDb.systemSetting.findFirstOrThrow({
      where: { key: "campaign.kThreshold", scope: "global" },
    });
    const { prismaRoot } = await import("@/lib/db/prisma");
    await prismaRoot.systemSetting.update({
      where: { key_scope_scopeId: { key: setting.key, scope: "global", scopeId: "" } },
      data: { valueJson: 7 },
    });
    const row = await migratorDb.auditEvent.findFirst({
      where: { subjectType: "department", subjectId: "faculty", action: "update" },
      orderBy: { at: "desc" },
    });
    expect(row?.departmentId).toBeNull();
    expect(row?.fieldChangesJson).toEqual({ valueJson: { before: 5, after: 7 } });
    await prismaRoot.systemSetting.update({
      where: { key_scope_scopeId: { key: setting.key, scope: "global", scopeId: "" } },
      data: { valueJson: 5 },
    });
  });

  it("tenant bypass and explicit records are audited; UPDATE on audit_event is denied to dept_app", async () => {
    await withTenantBypass(
      { isAdmin: true, user: { id: "admin-1" } },
      "test bypass",
      async (tx) => {
        await record(tx, {
          action: "export",
          subjectType: "department",
          subjectId: DEPT_CS,
          reason: "csv",
        });
      },
    );
    const bypass = await migratorDb.auditEvent.findFirst({
      where: { action: "tenant_bypass", reason: "test bypass" },
    });
    expect(bypass).toMatchObject({ actorUserId: "admin-1", departmentId: null });
    expect(
      await migratorDb.auditEvent.findFirst({ where: { action: "export", reason: "csv" } }),
    ).toBeTruthy();
    const c = await rawClient("app");
    try {
      await expect(
        c.query("UPDATE audit_event SET reason = 'x' WHERE action = 'export'"),
      ).rejects.toThrow(/permission denied|append-only/);
      await expect(c.query("DELETE FROM audit_event WHERE action = 'export'")).rejects.toThrow(
        /permission denied|append-only/,
      );
    } finally {
      await c.end();
    }
  });
});
