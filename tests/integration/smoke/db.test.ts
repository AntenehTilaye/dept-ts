import { describe, expect, it } from "vitest";
import { appDb, migratorDb, rawClient, testSchema } from "../../setup/db";

describe("database smoke", () => {
  it("runs on the per-run schema with both roles", async () => {
    expect(testSchema).toMatch(/^it_[0-9a-f]{8}$/);
    const rows = await appDb.$queryRaw<Array<{ one: number }>>`SELECT 1::int AS one`;
    expect(rows[0]?.one).toBe(1);
    const c = await rawClient("app");
    try {
      const { rows: sp } = await c.query<{ search_path: string }>("SHOW search_path");
      expect(sp[0]?.search_path).toContain(testSchema);
      const { rows: tables } = await c.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1",
        [testSchema],
      );
      expect(tables.map((t) => t.table_name)).toEqual(
        expect.arrayContaining(["_prisma_migrations", "system_setting"]),
      );
    } finally {
      await c.end();
    }
  });

  it("dept_app cannot bypass row level security while dept_migrator can", async () => {
    const c = await rawClient("migrator");
    try {
      const { rows } = await c.query<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>(
        "SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('dept_app','dept_migrator') ORDER BY 1",
      );
      expect(rows).toEqual([
        { rolname: "dept_app", rolbypassrls: false, rolsuper: false },
        { rolname: "dept_migrator", rolbypassrls: true, rolsuper: false },
      ]);
    } finally {
      await c.end();
    }
  });

  it("the pgboss schema exists and is owned by dept_app", async () => {
    const rows = await migratorDb.$queryRaw<Array<{ owner: string }>>`
      SELECT pg_catalog.pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'pgboss'`;
    expect(rows[0]?.owner).toBe("dept_app");
  });

  it("the minimal seed wrote app.version and dept_app can read the global table", async () => {
    const setting = await appDb.systemSetting.findUnique({
      where: { key_scope_scopeId: { key: "app.version", scope: "global", scopeId: "" } },
    });
    expect(setting?.valueJson).toBe("0.0.0");
  });
});
