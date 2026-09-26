import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { dispatchPending } from "@/platform/audit/outbox";
import { createRecord } from "@/platform/feature";
import type { Actor } from "@/platform/identity/can";
import { rebuild, search } from "@/platform/search";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// A module makes its own subject type searchable by registering where its rows are and saying
// when one changed. Nothing in the search kernel knows what a committee is, so this checks the
// registration rather than the index: a committee is found by its name and by its mandate, both
// through the live path and through a rebuild.

vi.setConfig({ testTimeout: 120_000 });
bootstrap();

let head: Actor;
let chairPersonId: string;

beforeAll(async () => {
  const dh = await migratorDb.user.findUniqueOrThrow({
    where: { email: "dh.cs@deptts.local" },
  });
  await withDept(DEPT_CS, async (tx) => {
    const p1 = await f.staff(tx, DEPT_CS, { userId: dh.id, email: "dh.cs@deptts.local" });
    const p2 = await f.staff(tx, DEPT_CS, {});
    head = { userId: dh.id, personId: p1.id, departmentId: DEPT_CS, isAdmin: false };
    chairPersonId = p2.id;
  });

  await withTenantTx(DEPT_CS, (tx) =>
    createRecord(tx, DEPT_CS, head, "committee", {
      data: {
        name: "Plagiarism Review Panel",
        purpose: "Looks at suspected academic dishonesty.",
        responsibilities: "Hears each case and recommends an outcome to the head.",
        chair: chairPersonId,
        type: "review",
      },
    }),
  );
  await dispatchPending(200);
});

describe("finding a committee", () => {
  it("finds it by name, through the event the module emits", async () => {
    const hits = await withTenantTx(DEPT_CS, (tx) => search(tx, head, "plagiarism"));
    const committee = hits.find((h) => h.subjectType === "committee");
    expect(committee).toBeDefined();
    expect(committee!.title).toBe("Plagiarism Review Panel");
  });

  it("finds it by what it is for, not only by what it is called", async () => {
    const hits = await withTenantTx(DEPT_CS, (tx) => search(tx, head, "academic dishonesty"));
    expect(hits.some((h) => h.subjectType === "committee")).toBe(true);
  });

  it("a rebuild holds the same committee the live index does", async () => {
    const result = await withTenantTx(DEPT_CS, (tx) => rebuild(tx, DEPT_CS, ["committee"]));
    expect(result.byType.committee).toBeGreaterThanOrEqual(1);
    const hits = await withTenantTx(DEPT_CS, (tx) => search(tx, head, "plagiarism"));
    expect(hits.some((h) => h.subjectType === "committee")).toBe(true);
  });
});
