import { describe, expect, it } from "vitest";
import { provisionUser } from "@/platform/identity/provision";
import { reconcileAll, reconcileDepartment } from "@/platform/identity/reconcile";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";
import { uniqueSuffix } from "../../setup/factories";

describe("derived grant reconciliation", () => {
  it("expires orphaned grants whose membership vanished and restores missing ones", async () => {
    const email = `orphan.${uniqueSuffix()}@deptts.local`;
    const { userId } = await provisionUser({
      email,
      name: "O",
      departmentId: DEPT_CS,
      roleKeys: ["instructor"],
      sendMail: false,
    });
    // corrupt state 1: membership deleted behind the service's back
    await migratorDb.member.deleteMany({ where: { userId, organizationId: DEPT_CS } });
    // corrupt state 2: a member whose grant was expired by hand
    const head = await migratorDb.user.findUniqueOrThrow({
      where: { email: "dh.cs@deptts.local" },
    });
    await migratorDb.roleGrant.updateMany({
      where: { userId: head.id, departmentId: DEPT_CS },
      data: { validTo: new Date() },
    });

    const summary = await reconcileDepartment(DEPT_CS);
    expect(summary.departmentId).toBe(DEPT_CS);
    expect(summary.orphaned).toBe(1);
    expect(summary.members).toBeGreaterThanOrEqual(6);

    const orphan = await withDept(DEPT_CS, (tx) => tx.roleGrant.findMany({ where: { userId } }));
    expect(orphan).toHaveLength(1);
    expect(orphan[0]!.validTo).toBeInstanceOf(Date);
    const restored = await withDept(DEPT_CS, (tx) =>
      tx.roleGrant.findMany({ where: { userId: head.id, validTo: null } }),
    );
    expect(restored).toHaveLength(1);
  });

  it("reconciles every department and is idempotent", async () => {
    const first = await reconcileAll();
    const ids = first.map((s) => s.departmentId);
    expect(ids).toEqual(expect.arrayContaining([DEPT_CS, DEPT_EE]));
    const second = await reconcileAll();
    expect(second.every((s) => s.orphaned === 0)).toBe(true);
    expect(second.find((s) => s.departmentId === DEPT_EE)?.members).toBeGreaterThanOrEqual(1);
  });
});
