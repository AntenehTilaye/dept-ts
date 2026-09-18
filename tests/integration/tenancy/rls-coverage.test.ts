import { describe, expect, it } from "vitest";
import {
  loadDmmf,
  tableName,
  departmentField,
  hasDepartmentRelation,
} from "../../../prisma/scripts/dmmf";
import { readManifest } from "../../../prisma/scripts/gen-rls";
import { rawClient, testSchema } from "../../setup/db";

// Re-run by every later phase: the live schema must police exactly the tables the manifest
// classifies as tenant or shared, and nothing else.
describe("row-level security coverage", () => {
  it("every tenant and shared table has FORCE RLS and a tenant_isolation policy; global tables have none", async () => {
    const manifest = readManifest()!;
    const c = await rawClient("migrator");
    try {
      const { rows: classes } = await c.query<{ relname: string; rls: boolean; force: boolean }>(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relkind = 'r'`,
        [testSchema],
      );
      const { rows: policies } = await c.query<{ tablename: string; policyname: string }>(
        "SELECT tablename, policyname FROM pg_policies WHERE schemaname = $1",
        [testSchema],
      );
      const byTable = new Map(classes.map((r) => [r.relname, r]));
      const policed = new Set(
        policies.filter((p) => p.policyname === "tenant_isolation").map((p) => p.tablename),
      );

      for (const e of [...manifest.tenant, ...manifest.shared]) {
        expect(byTable.get(e.table), `${e.table} exists`).toBeDefined();
        expect(byTable.get(e.table)?.rls, `${e.table} rls`).toBe(true);
        expect(byTable.get(e.table)?.force, `${e.table} force rls`).toBe(true);
        expect(policed.has(e.table), `${e.table} policy`).toBe(true);
      }
      for (const e of manifest.global) {
        expect(byTable.get(e.table)?.rls, `${e.table} must not have rls`).toBe(false);
        expect(policed.has(e.table), `${e.table} must not have a policy`).toBe(false);
      }
    } finally {
      await c.end();
    }
  });

  it("the manifest covers exactly the DMMF models and every departmentId model is indexed on it and related to Department", async () => {
    const dmmf = await loadDmmf();
    const manifest = readManifest()!;
    const listed = [...manifest.tenant, ...manifest.shared, ...manifest.global]
      .map((e) => e.model)
      .sort();
    expect(listed).toEqual(dmmf.datamodel.models.map((m) => m.name).sort());

    const c = await rawClient("migrator");
    try {
      const { rows } = await c.query<{ tablename: string; indexdef: string }>(
        "SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = $1",
        [testSchema],
      );
      for (const model of dmmf.datamodel.models) {
        if (!departmentField(model)) continue;
        expect(hasDepartmentRelation(model), `${model.name} relation`).toBe(true);
        const table = tableName(model);
        const leading = rows.filter(
          (r) => r.tablename === table && /\(\s*"?department_id"?\s*[,)]/.test(r.indexdef),
        );
        expect(
          leading.length,
          `${table} needs an index starting with department_id`,
        ).toBeGreaterThan(0);
      }
    } finally {
      await c.end();
    }
  });
});
