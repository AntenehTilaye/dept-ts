import { describe, expect, it, vi } from "vitest";
import linear from "../../fixtures/workflows/linear.json";
import { PROVISIONAL_DEFINITION_KEYS, seedWorkflows } from "../../../prisma/seed/workflows";
import {
  activeDefinition,
  InvalidDefinitionError,
  listDefinitions,
  upsertDefinition,
} from "@/platform/workflow/registry";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";
import { uniqueSuffix } from "../../setup/factories";

vi.setConfig({ testTimeout: 60_000 });

describe("workflow definitions", () => {
  it("after the seed every definition is compiled from a feature or provisional; seedWorkflows is idempotent", async () => {
    await seedWorkflows(migratorDb);
    const before = await migratorDb.workflowDefinition.count();
    await seedWorkflows(migratorDb);
    expect(await migratorDb.workflowDefinition.count()).toBe(before);
    const rows = await migratorDb.workflowDefinition.findMany({
      where: { NOT: { key: { startsWith: "test." } } },
    });
    for (const r of rows) {
      expect(
        r.featureVersionId !== null || PROVISIONAL_DEFINITION_KEYS.includes(r.key),
        r.key,
      ).toBe(true);
    }
  });

  it("rejects invalid definitions and resolves department overrides over faculty rows", async () => {
    await expect(
      upsertDefinition({ ...linear, key: `bad.${uniqueSuffix()}`, initialState: "nowhere" }),
    ).rejects.toThrow(InvalidDefinitionError);
    const key = `test.scope.${uniqueSuffix()}`;
    const faculty = await upsertDefinition({ ...linear, key, departmentId: null, isSystem: true });
    expect(faculty.departmentId).toBeNull();
    const cs = await upsertDefinition({ ...linear, key, departmentId: DEPT_CS });
    expect((await withDept(DEPT_CS, (tx) => activeDefinition(tx, key, DEPT_CS)))?.id).toBe(cs.id);
    expect((await withDept(DEPT_EE, (tx) => activeDefinition(tx, key, DEPT_EE)))?.id).toBe(
      faculty.id,
    );
    expect(
      await withDept(DEPT_EE, (tx) => activeDefinition(tx, "missing.key", DEPT_EE)),
    ).toBeNull();
    const listed = await listDefinitions(migratorDb);
    expect(
      listed
        .filter((d) => d.key === key)
        .map((d) => d.departmentId)
        .sort(),
    ).toEqual([DEPT_CS, null].sort());
    const draft = await upsertDefinition(
      { ...linear, key, departmentId: DEPT_CS },
      { activate: false },
    );
    expect(draft.status).toBe("draft");
    expect((await withDept(DEPT_CS, (tx) => activeDefinition(tx, key, DEPT_CS)))?.id).toBe(cs.id);
  });
});
