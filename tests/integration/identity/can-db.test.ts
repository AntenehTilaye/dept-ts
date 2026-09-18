import { beforeAll, describe, expect, it } from "vitest";
import { can, type Actor } from "@/platform/identity/can";
import { dbPolicyStore, invalidatePermissionKeys } from "@/platform/identity/policy-store";
import { DEFAULT_MANAGE_EXCLUDED } from "@/platform/identity/permissions-matrix";
import { migratorDb } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";

async function actorFor(email: string, departmentId = DEPT_CS): Promise<Actor> {
  const user = await migratorDb.user.findUniqueOrThrow({ where: { email } });
  return { userId: user.id, personId: null, departmentId, isAdmin: user.role === "admin" };
}

describe("database-backed policy store", () => {
  let head: Actor;
  let deputy: Actor;
  let instructor: Actor;
  let admin: Actor;

  beforeAll(async () => {
    [head, deputy, instructor, admin] = await Promise.all([
      actorFor("dh.cs@deptts.local"),
      actorFor("dpt.cs@deptts.local"),
      actorFor("instructor1.cs@deptts.local"),
      actorFor("admin@deptts.local"),
    ]);
  });

  it("loads the seeded faculty matrix and every registered key", async () => {
    const matrix = await dbPolicyStore.rolePermissions(DEPT_CS);
    expect(matrix.get("department_head")?.get("task.manage")).toBe("full");
    expect(matrix.get("deputy_head")?.get("admin.department")).toBeUndefined();
    expect(matrix.get("instructor")?.get("portfolio.submit_own")).toBe("own");
    const keys = await dbPolicyStore.registeredKeys();
    expect(keys.has("task.manage")).toBe(true);
    expect(keys.size).toBeGreaterThan(40);
  });

  it("returns the derived department grants of seeded members only", async () => {
    const now = new Date();
    expect(await dbPolicyStore.activeGrants(head.userId, DEPT_CS, now)).toEqual([
      { roleKey: "department_head", scopeType: "department", scopeId: "" },
    ]);
    expect(await dbPolicyStore.activeGrants(head.userId, DEPT_EE, now)).toEqual([]);
    expect(await dbPolicyStore.activeGrants(admin.userId, DEPT_CS, now)).toEqual([]);
  });

  it("decides for the seeded roles", async () => {
    expect((await can(dbPolicyStore, head, "portfolio.approve")).allowed).toBe(true);
    expect((await can(dbPolicyStore, head, "feature.manage")).allowed).toBe(false);
    expect((await can(dbPolicyStore, admin, "feature.manage")).allowed).toBe(true);
    expect((await can(dbPolicyStore, deputy, "task.manage")).allowed).toBe(true);
    const excluded = await can(dbPolicyStore, deputy, "portfolio.approve");
    expect(excluded).toMatchObject({ allowed: false });
    expect(excluded.reason).toMatch(/excluded from manage/);
    expect((await can(dbPolicyStore, instructor, "task.manage")).allowed).toBe(false);
    expect((await can(dbPolicyStore, instructor, "staff.view")).allowed).toBe(true);
    expect(
      (await can(dbPolicyStore, { ...head, departmentId: DEPT_EE }, "task.manage")).allowed,
    ).toBe(false);
  });

  it("lets a department override the faculty default and the manage exclusions", async () => {
    const role = await migratorDb.role.findFirstOrThrow({
      where: { key: "instructor", departmentId: null },
    });
    await migratorDb.rolePermission.create({
      data: {
        departmentId: DEPT_CS,
        roleId: role.id,
        permissionKey: "task.manage",
        level: "manage",
      },
    });
    expect((await can(dbPolicyStore, instructor, "task.manage")).allowed).toBe(true);
    expect(
      (await can(dbPolicyStore, { ...instructor, departmentId: DEPT_EE }, "task.manage")).allowed,
    ).toBe(false);
    const ee = await dbPolicyStore.rolePermissions(DEPT_EE);
    expect(ee.get("instructor")?.get("task.manage")).toBeUndefined();

    expect([...(await dbPolicyStore.manageExcluded(DEPT_CS))].sort()).toEqual(
      [...DEFAULT_MANAGE_EXCLUDED].sort(),
    );
    await migratorDb.systemSetting.create({
      data: {
        key: "rbac.manageExcludedPermissions",
        scope: "department",
        scopeId: DEPT_CS,
        valueJson: [],
      },
    });
    expect((await dbPolicyStore.manageExcluded(DEPT_CS)).size).toBe(0);
    expect((await can(dbPolicyStore, deputy, "portfolio.approve")).allowed).toBe(true);
    expect((await dbPolicyStore.manageExcluded(DEPT_EE)).has("portfolio.approve")).toBe(true);

    await migratorDb.systemSetting.delete({
      where: {
        key_scope_scopeId: {
          key: "rbac.manageExcludedPermissions",
          scope: "department",
          scopeId: DEPT_CS,
        },
      },
    });
    await migratorDb.rolePermission.deleteMany({ where: { departmentId: DEPT_CS } });
  });

  it("caches registered keys until invalidated", async () => {
    const before = await dbPolicyStore.registeredKeys();
    await migratorDb.permission.create({
      data: {
        key: "zz.test",
        module: "zz",
        action: "test",
        description: "temporary",
        isSystem: false,
      },
    });
    expect((await dbPolicyStore.registeredKeys()).has("zz.test")).toBe(false);
    invalidatePermissionKeys();
    expect((await dbPolicyStore.registeredKeys()).has("zz.test")).toBe(true);
    expect(before.has("zz.test")).toBe(false);
    await migratorDb.permission.delete({ where: { key: "zz.test" } });
    invalidatePermissionKeys();
  });
});
