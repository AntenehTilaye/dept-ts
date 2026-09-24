import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantBypass, withTenantTx } from "@/lib/db/tenant";
import type { Actor } from "@/platform/identity/can";
import { act, createRecord, featureCounters, getNav, publishVersionOn } from "@/platform/feature";
import { jsonHash, lockedHash } from "@/platform/feature/locks";
import { FeatureDefinitionSchema, type FeatureDefinition } from "@/platform/feature/schema";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// The sidebar and the dashboard numbers are queries over the published definitions, so a feature
// an administrator publishes appears without a deployment and a department that customised a
// process still sees one entry.

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

const bypass = { worker: true as const, jobName: "test" };
let instructor: Actor;
let head: Actor;
let student: Actor;

async function actorFor(email: string): Promise<Actor> {
  const user = await migratorDb.user.findUniqueOrThrow({ where: { email } });
  const person = await withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS, { userId: user.id, email }));
  return {
    userId: user.id,
    personId: person.id,
    departmentId: DEPT_CS,
    isAdmin: user.role === "admin",
  };
}

beforeAll(async () => {
  instructor = await actorFor("instructor1.cs@deptts.local");
  head = await actorFor("dh.cs@deptts.local");
  student = await actorFor("rep.cs@deptts.local");
});

describe("navigation and counters", () => {
  it("lists the features a role may see, in their group and order", async () => {
    const entries = await withTenantTx(DEPT_CS, (tx) =>
      getNav(tx, DEPT_CS, instructor, { deptSlug: "cs" }),
    );
    const keys = entries.map((e) => e.key);
    expect(keys).toContain("task");
    expect(keys).toContain("generic_request");
    expect(entries.find((e) => e.key === "task")).toMatchObject({
      group: "operations",
      href: "/d/cs/f/task",
      label: "Tasks",
    });
    // the order inside a group is the definition's own
    const operations = entries.filter((e) => e.group === "operations").map((e) => e.order);
    expect([...operations].sort((a, b) => a - b)).toEqual(operations);
  });

  it("hides a feature from a role its definition does not name", async () => {
    const entries = await withTenantTx(DEPT_CS, (tx) =>
      getNav(tx, DEPT_CS, student, { deptSlug: "cs", roles: ["student"] }),
    );
    expect(entries.map((e) => e.key)).not.toContain("generic_request");
  });

  it("gives a preset with its own label an entry of its own", async () => {
    const entries = await withTenantTx(DEPT_CS, (tx) =>
      getNav(tx, DEPT_CS, head, { deptSlug: "cs" }),
    );
    const committee = entries.find((e) => e.key === "task:committee_task");
    expect(committee).toMatchObject({
      label: "Committee task",
      href: "/d/cs/f/task?preset=committee_task",
      presetKey: "committee_task",
    });
  });

  it("lets a department definition shadow the faculty one with the same key", async () => {
    const faculty = await migratorDb.featureDefinition.findFirstOrThrow({
      where: { key: "generic_request", departmentId: null },
    });
    const active = await migratorDb.featureDefinitionVersion.findUniqueOrThrow({
      where: { id: faculty.activeVersionId! },
    });
    const def: FeatureDefinition = FeatureDefinitionSchema.parse(active.json);
    const own = structuredClone(def) as FeatureDefinition;
    own.labels = { singular: "CS request", plural: "CS requests" };

    const created = await withTenantBypass(bypass, "department definition", async (tx) => {
      const definition = await tx.featureDefinition.create({
        data: {
          key: own.key,
          departmentId: DEPT_CS,
          name: "CS requests",
          icon: own.navigation.icon,
          navGroup: own.navigation.group,
          navOrder: own.navigation.order,
          scopeLevel: "department",
          isSystem: false,
          createdBy: head.userId,
        },
      });
      const version = await tx.featureDefinitionVersion.create({
        data: {
          definitionId: definition.id,
          version: 1,
          status: "draft",
          json: own as never,
          jsonHash: jsonHash(own),
          lockedHash: lockedHash(own, false),
          changeNote: "department override",
          createdBy: head.userId,
        },
      });
      await publishVersionOn(tx, definition.id, version.id, {
        userId: head.userId,
        isAdmin: true,
      });
      return definition;
    });

    const entries = await withTenantTx(DEPT_CS, (tx) =>
      getNav(tx, DEPT_CS, head, { deptSlug: "cs" }),
    );
    const requests = entries.filter((e) => e.key === "generic_request");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.label).toBe("CS requests");

    await withTenantBypass(bypass, "clean up", async (tx) => {
      await tx.featureDefinition.update({
        where: { id: created.id },
        data: { activeVersionId: null },
      });
      await tx.featureDefinitionVersion.deleteMany({ where: { definitionId: created.id } });
      await tx.featureDefinition.delete({ where: { id: created.id } });
    });
  });

  it("counts records the way the definition's counters ask", async () => {
    const record = await withTenantTx(DEPT_CS, (tx) =>
      createRecord(tx, DEPT_CS, instructor, "generic_request", {
        data: { subject: "Counter", details: "counts", urgency: "routine" },
      }),
    );
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "request", "submit", instructor));

    const counters = await withTenantTx(DEPT_CS, (tx) =>
      featureCounters(tx, DEPT_CS, head, "cs"),
    );
    const decide = counters.find((c) => c.featureKey === "generic_request" && c.key === "to_decide");
    expect(decide).toBeDefined();
    expect(decide!.href).toBe("/d/cs/f/generic_request?view=waiting");

    const live = await migratorDb.featureRecord.count({
      where: { departmentId: DEPT_CS, currentStateKey: "decision" },
    });
    expect(decide!.count).toBe(live);
  });
});
