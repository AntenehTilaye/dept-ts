import { beforeAll, describe, expect, it } from "vitest";
import { scopedClient, TenantMismatchError } from "@/lib/db/scoped";
import {
  setBypassAuditor,
  withTenantTx,
  withTenantBypass,
  type BypassActor,
} from "@/lib/db/tenant";
import { tenancyOf } from "@/lib/db/tenancy-manifest";
import { appDb, migratorDb } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";

// The department-scoped client (query extension + transaction-local setting) over dept_app.
describe("scoped client", () => {
  const cs = scopedClient(DEPT_CS, appDb);

  beforeAll(async () => {
    await migratorDb.role.createMany({
      data: [
        { key: "sc_shared_global", name: "Global", departmentId: null },
        { key: "sc_ee_only", name: "EE", departmentId: DEPT_EE },
      ],
    });
  });

  it("injects the active department into writes", async () => {
    const created = await cs.role.create({ data: { key: "sc_cs_created", name: "CS" } });
    expect(created.departmentId).toBe(DEPT_CS);
    const stored = await migratorDb.role.findUnique({ where: { id: created.id } });
    expect(stored?.departmentId).toBe(DEPT_CS);
  });

  it("rejects a foreign departmentId before the database is reached", async () => {
    await expect(
      cs.role.create({ data: { key: "sc_foreign", name: "x", departmentId: DEPT_EE } }),
    ).rejects.toBeInstanceOf(TenantMismatchError);
    expect(await migratorDb.role.count({ where: { key: "sc_foreign" } })).toBe(0);
  });

  it("reads see the department's rows and faculty-wide rows only", async () => {
    const mine = { key: { startsWith: "sc_" } };
    const keys = (await cs.role.findMany({ where: mine, orderBy: { key: "asc" } })).map(
      (r) => r.key,
    );
    expect(keys).toEqual(["sc_cs_created", "sc_shared_global"]);
    expect(await cs.role.count({ where: mine })).toBe(2);
  });

  it("raw queries run inside the department transaction too", async () => {
    const rows = await cs.$queryRaw<
      Array<{ key: string }>
    >`SELECT key FROM role WHERE key LIKE 'sc#_%' ESCAPE '#' ORDER BY key`;
    expect(rows.map((r) => r.key)).toEqual(["sc_cs_created", "sc_shared_global"]);
    const unsafe = await cs.$queryRawUnsafe<Array<{ n: number }>>(
      "SELECT count(*)::int AS n FROM role WHERE key LIKE $1",
      "sc_%",
    );
    expect(unsafe[0]?.n).toBe(2);
    const setting = await cs.$queryRaw<
      Array<{ v: string }>
    >`SELECT current_setting('app.current_department_id', true) AS v`;
    expect(setting[0]?.v).toBe(DEPT_CS);
    expect(await cs.$executeRaw`SELECT 1`).toBe(1);
  });

  it("cross-department updates report count 0 and a faculty-wide write needs bypass", async () => {
    const res = await cs.role.updateMany({
      where: { key: "sc_ee_only" },
      data: { name: "hacked" },
    });
    expect(res.count).toBe(0);
    await expect(
      cs.role.create({ data: { key: "sc_no_bypass", name: "x", departmentId: null } }),
    ).rejects.toThrow(/row-level security/);
  });

  it("nested includes through a global model are filtered by RLS, not by the extension", async () => {
    const depts = await cs.department.findMany({
      include: { roles: true },
      orderBy: { code: "asc" },
    });
    expect(depts.find((d) => d.id === DEPT_EE)?.roles).toEqual([]);
    expect(
      depts
        .find((d) => d.id === DEPT_CS)
        ?.roles.map((r) => r.key)
        .filter((k) => k.startsWith("sc_")),
    ).toEqual(["sc_cs_created"]);
  });

  it("injects into createMany rows and upsert create blocks", async () => {
    const many = await cs.role.createMany({
      data: [
        { key: "sc_many_a", name: "A" },
        { key: "sc_many_b", name: "B" },
      ],
    });
    expect(many.count).toBe(2);
    expect(
      await migratorDb.role.count({
        where: { key: { startsWith: "sc_many_" }, departmentId: DEPT_CS },
      }),
    ).toBe(2);
    const up = await cs.role.upsert({
      where: { departmentId_key: { departmentId: DEPT_CS, key: "sc_upserted" } },
      create: { key: "sc_upserted", name: "new" },
      update: { name: "updated" },
    });
    expect(up.departmentId).toBe(DEPT_CS);
    const again = await cs.role.upsert({
      where: { departmentId_key: { departmentId: DEPT_CS, key: "sc_upserted" } },
      create: { key: "sc_upserted", name: "new" },
      update: { name: "updated" },
    });
    expect(again.name).toBe("updated");
  });

  it("classifies models from the committed manifest", () => {
    expect(tenancyOf("Role")).toBe("shared");
    expect(tenancyOf("Department")).toBe("global");
    expect(() => tenancyOf("NotAModel")).toThrow(/not classified/);
  });

  it("withTenantBypass reports the actor and reason to the registered auditor", async () => {
    process.env.DATABASE_SCHEMA = (await import("../../setup/db")).testSchema;
    const calls: Array<{ actor: BypassActor; reason: string }> = [];
    setBypassAuditor(async (_tx, actor, reason) => {
      calls.push({ actor, reason });
    });
    await withTenantBypass({ isAdmin: true, user: { id: "u1" } }, "faculty page", async (tx) =>
      tx.role.count(),
    );
    expect(calls).toEqual([
      { actor: { isAdmin: true, user: { id: "u1" } }, reason: "faculty page" },
    ]);
  });

  it("withTenantTx scopes a whole transaction and withTenantBypass lifts the boundary", async () => {
    process.env.DATABASE_SCHEMA = (await import("../../setup/db")).testSchema;
    const inCs = await withTenantTx(DEPT_CS, async (tx) => {
      await tx.role.create({ data: { key: "sc_tx_role", name: "tx", departmentId: DEPT_CS } });
      return (
        await tx.role.findMany({ where: { key: { startsWith: "sc_" } }, orderBy: { key: "asc" } })
      ).map((r) => r.key);
    });
    expect(inCs).toEqual(
      expect.arrayContaining(["sc_cs_created", "sc_shared_global", "sc_tx_role"]),
    );
    expect(inCs).not.toContain("sc_ee_only");
    const all = await withTenantBypass(
      { worker: true, jobName: "test" },
      "test bypass",
      async (tx) =>
        (
          await tx.role.findMany({ where: { key: { startsWith: "sc_" } }, orderBy: { key: "asc" } })
        ).map((r) => r.key),
    );
    expect(all).toEqual(
      expect.arrayContaining(["sc_cs_created", "sc_ee_only", "sc_shared_global", "sc_tx_role"]),
    );
  });
});
