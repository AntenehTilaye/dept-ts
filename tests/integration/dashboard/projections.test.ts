import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { dispatchPending } from "@/platform/audit/outbox";
import {
  getDashboard,
  readProjection,
  rebuildProjections,
} from "@/platform/dashboard";
import { createTaskRecord } from "@/platform/feature";
import type { Actor } from "@/platform/identity/can";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// A projection is only worth keeping if the kept answer equals the computed one. These tests
// drive the real events through the outbox, then rebuild from the tables and compare — and check
// that the dashboard shows a head the department and an instructor their own week.

vi.setConfig({ testTimeout: 120_000 });
bootstrap();

let head: Actor;
let instructor: Actor;
let instructorPersonId: string;

beforeAll(async () => {
  const [dh, ins] = await Promise.all([
    migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } }),
    migratorDb.user.findUniqueOrThrow({ where: { email: "instructor1.cs@deptts.local" } }),
  ]);
  const [p1, p2] = await Promise.all([
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS, { userId: dh.id, email: "dh.cs@deptts.local" })),
    withDept(DEPT_CS, (tx) =>
      f.staff(tx, DEPT_CS, { userId: ins.id, email: "instructor1.cs@deptts.local" }),
    ),
  ]);
  head = { userId: dh.id, personId: p1.id, departmentId: DEPT_CS, isAdmin: false };
  instructorPersonId = p2.id;
  instructor = { userId: ins.id, personId: p2.id, departmentId: DEPT_CS, isAdmin: false };

  // two tasks for the instructor, one of them already late
  for (const [title, dueAt] of [
    ["Write the CS201 examination", new Date(Date.now() + 3 * 86_400_000)],
    ["Return the marked scripts", new Date(Date.now() - 2 * 86_400_000)],
  ] as const) {
    await withTenantTx(DEPT_CS, (tx) =>
      createTaskRecord(tx, DEPT_CS, head, {
        title,
        dueAt,
        assignees: [{ type: "person", id: instructorPersonId }],
      }),
    );
  }
  await dispatchPending(200);
});

describe("dashboard projections", () => {
  it("the outbox keeps the open-work projection current", async () => {
    const rows = await withTenantTx(DEPT_CS, (tx) =>
      readProjection(tx, DEPT_CS, "openWork"),
    );
    const mine = rows.find((r) => r.dimensions.personId === instructorPersonId);
    expect(mine).toBeDefined();
    expect(mine!.values.open).toBeGreaterThanOrEqual(2);
    expect(mine!.values.overdue).toBeGreaterThanOrEqual(1);
  });

  it("a rebuild produces exactly what the live path holds", async () => {
    const before = await withTenantTx(DEPT_CS, (tx) => readProjection(tx, DEPT_CS, "openWork"));
    await withTenantTx(DEPT_CS, (tx) => rebuildProjections(tx, DEPT_CS, ["openWork"]));
    const after = await withTenantTx(DEPT_CS, (tx) => readProjection(tx, DEPT_CS, "openWork"));
    expect(after.map((r) => [r.rowKey, r.values])).toEqual(
      before.map((r) => [r.rowKey, r.values]),
    );
  });

  it("replaying the same event changes nothing", async () => {
    const before = await withTenantTx(DEPT_CS, (tx) => readProjection(tx, DEPT_CS, "openWork"));
    // the dispatcher marks events published; asking it again is the replay this guards against
    await migratorDb.domainEvent.updateMany({
      where: { name: "task.created", departmentId: DEPT_CS },
      data: { publishedAt: null },
    });
    await dispatchPending(200);
    const after = await withTenantTx(DEPT_CS, (tx) => readProjection(tx, DEPT_CS, "openWork"));
    expect(after.map((r) => [r.rowKey, r.values])).toEqual(
      before.map((r) => [r.rowKey, r.values]),
    );
  });

  it("the head's dashboard is the department; the instructor's is their own week", async () => {
    const headWidgets = await withTenantTx(DEPT_CS, (tx) =>
      getDashboard({ db: tx, actor: head, departmentId: DEPT_CS, deptSlug: "cs" }),
    );
    const keys = headWidgets.map((w) => w.key);
    expect(keys).toContain("departmentLoad");
    expect(keys).toContain("myWork");

    const instructorWidgets = await withTenantTx(DEPT_CS, (tx) =>
      getDashboard({ db: tx, actor: instructor, departmentId: DEPT_CS, deptSlug: "cs" }),
    );
    const instructorKeys = instructorWidgets.map((w) => w.key);
    expect(instructorKeys).toContain("myWork");
    // who is carrying what is the head's business
    expect(instructorKeys).not.toContain("departmentLoad");

    const load = headWidgets.find((w) => w.key === "departmentLoad")!;
    expect(load.rows?.some((r) => r.value.includes("open"))).toBe(true);
  });
});
