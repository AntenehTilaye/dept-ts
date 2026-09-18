import { beforeAll, describe, expect, it } from "vitest";
import { readManifest } from "../../../prisma/scripts/gen-rls";
import { appDb, migratorDb, rawClient, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";

// Proves that RLS, not application code, is the tenant boundary for the dept_app role.
// Shared tables (nullable departmentId) are exercised on `role` now; the strict-table block
// at the end is parameterised over the manifest and fills in as tenant models arrive.
const manifest = readManifest()!;

describe("row-level security isolation (shared table: role)", () => {
  beforeAll(async () => {
    await migratorDb.role.createMany({
      data: [
        { key: "t_global_role", name: "Global", departmentId: null },
        { key: "t_cs_role", name: "CS only", departmentId: DEPT_CS },
        { key: "t_ee_role", name: "EE only", departmentId: DEPT_EE },
      ],
    });
  });

  it("dept_app sees the active department's rows plus faculty-wide rows in findMany, count and raw SQL", async () => {
    const mine = { key: { startsWith: "t_" } };
    const keys = await withDept(DEPT_CS, async (tx) =>
      (await tx.role.findMany({ where: mine, orderBy: { key: "asc" } })).map((r) => r.key),
    );
    expect(keys).toEqual(["t_cs_role", "t_global_role"]);
    expect(await withDept(DEPT_CS, (tx) => tx.role.count({ where: mine }))).toBe(2);
    const raw = await withDept(
      DEPT_CS,
      (tx) =>
        tx.$queryRaw<
          Array<{ key: string }>
        >`SELECT key FROM role WHERE key LIKE 't#_%' ESCAPE '#' ORDER BY key`,
    );
    expect(raw.map((r) => r.key)).toEqual(["t_cs_role", "t_global_role"]);
  });

  it("nested reads through a global parent are filtered too", async () => {
    const depts = await withDept(DEPT_CS, (tx) =>
      tx.department.findMany({ include: { roles: true }, orderBy: { code: "asc" } }),
    );
    expect(
      depts
        .find((d) => d.id === DEPT_CS)
        ?.roles.map((r) => r.key)
        .filter((k) => k.startsWith("t_")),
    ).toEqual(["t_cs_role"]);
    expect(depts.find((d) => d.id === DEPT_EE)?.roles).toEqual([]);
  });

  it("cross-department updates and deletes affect zero rows", async () => {
    const updated = await withDept(DEPT_CS, (tx) =>
      tx.role.updateMany({ where: { key: "t_ee_role" }, data: { name: "hacked" } }),
    );
    expect(updated.count).toBe(0);
    const deleted = await withDept(DEPT_CS, (tx) =>
      tx.role.deleteMany({ where: { key: "t_ee_role" } }),
    );
    expect(deleted.count).toBe(0);
    const ee = await migratorDb.role.findUnique({
      where: { departmentId_key: { departmentId: DEPT_EE, key: "t_ee_role" } },
    });
    expect(ee).toMatchObject({ name: "EE only" });
  });

  it("a connection without the setting sees only faculty-wide rows", async () => {
    const keys = (
      await appDb.role.findMany({ where: { key: { startsWith: "t_" } }, orderBy: { key: "asc" } })
    ).map((r) => r.key);
    expect(keys).toEqual(["t_global_role"]);
  });

  it("WITH CHECK rejects a row for another department and a faculty-wide row without bypass", async () => {
    await expect(
      withDept(DEPT_CS, (tx) =>
        tx.role.create({ data: { key: "smuggled", name: "x", departmentId: DEPT_EE } }),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withDept(DEPT_CS, (tx) =>
        tx.role.create({ data: { key: "smuggled_global", name: "x", departmentId: null } }),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await migratorDb.role.count({ where: { key: { startsWith: "smuggled" } } })).toBe(0);
  });

  it("bypass sees and may write every row", async () => {
    const all = await appDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_bypass', 'on', true)`;
      await tx.role.create({ data: { key: "t_bypass_global", name: "b", departmentId: null } });
      return tx.role.findMany({ where: { key: { startsWith: "t_" } }, orderBy: { key: "asc" } });
    });
    expect(all.map((r) => r.key)).toEqual([
      "t_bypass_global",
      "t_cs_role",
      "t_ee_role",
      "t_global_role",
    ]);
  });

  it("the setting is transaction-local and never leaks to the next query on the pool", async () => {
    await withDept(DEPT_EE, (tx) => tx.role.count());
    const c = await rawClient("app");
    try {
      const { rows } = await c.query<{ v: string | null }>(
        "SELECT current_setting('app.current_department_id', true) AS v",
      );
      expect(rows[0]?.v ?? "").toBe("");
    } finally {
      await c.end();
    }
    expect(
      (await appDb.role.findMany({ where: { key: { startsWith: "t_" } } })).map((r) => r.key),
    ).not.toContain("t_ee_role");
  });
});

describe.each(manifest.tenant.map((e) => [e.table] as const))("strict tenant table %s", (table) => {
  it("is not visible at all without the setting", async () => {
    const c = await rawClient("app");
    try {
      const { rows } = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`);
      expect(rows[0]?.n).toBe("0");
    } finally {
      await c.end();
    }
  });
});

describe("row-level security isolation (strict tenant table: role_grant)", () => {
  it("shows a department only its own grants and hides them from every other department", async () => {
    const head = await migratorDb.user.findUniqueOrThrow({
      where: { email: "dh.cs@deptts.local" },
    });
    const cs = await withDept(DEPT_CS, (tx) =>
      tx.roleGrant.findMany({ where: { userId: head.id } }),
    );
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.every((g) => g.departmentId === DEPT_CS)).toBe(true);
    expect(
      await withDept(DEPT_EE, (tx) => tx.roleGrant.count({ where: { userId: head.id } })),
    ).toBe(0);
    const touched = await withDept(DEPT_EE, (tx) =>
      tx.roleGrant.updateMany({ where: { userId: head.id }, data: { validTo: new Date() } }),
    );
    expect(touched.count).toBe(0);
    expect(
      (await migratorDb.roleGrant.findFirst({ where: { userId: head.id, departmentId: DEPT_CS } }))
        ?.validTo,
    ).toBeNull();
  });

  it("rejects a grant written for another department", async () => {
    const head = await migratorDb.user.findUniqueOrThrow({
      where: { email: "dh.cs@deptts.local" },
    });
    const role = await migratorDb.role.findFirstOrThrow({
      where: { key: "instructor", departmentId: null },
    });
    await expect(
      withDept(DEPT_CS, (tx) =>
        tx.roleGrant.create({
          data: {
            departmentId: DEPT_EE,
            userId: head.id,
            roleId: role.id,
            scopeType: "department",
            scopeId: "",
            source: "manual",
            derivedFromId: "",
            validFrom: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
