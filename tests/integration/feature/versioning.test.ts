import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantBypass, withTenantTx } from "@/lib/db/tenant";
import type { Actor } from "@/platform/identity/can";
import { act, createRecord, publishVersionOn } from "@/platform/feature";
import { jsonHash, lockedHash } from "@/platform/feature/locks";
import { BLOCK, createMigration, planMigration, runMigrationBatch } from "@/platform/feature/migrate";
import { FeatureDefinitionSchema, type FeatureDefinition } from "@/platform/feature/schema";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

// Publishing never moves a record that is already running: it pins the version it was created
// on. Moving them is a separate, deliberate act with a map the administrator writes, and a state
// with no home on the new version blocks its records rather than guessing.

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

const bypass = { worker: true as const, jobName: "test" };
let instructor: Actor;
let admin: Actor;

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

async function definition() {
  return migratorDb.featureDefinition.findFirstOrThrow({
    where: { key: "generic_request", departmentId: null },
  });
}

/**
 * Publishes a version in which the last step has been renamed — the change that actually needs a
 * migration, because a running record may be sitting in the state that disappears.
 */
async function publishRenamed(): Promise<{ versionId: string; previousId: string; from: string; to: string }> {
  const row = await definition();
  const active = await migratorDb.featureDefinitionVersion.findUniqueOrThrow({
    where: { id: row.activeVersionId! },
  });
  const def: FeatureDefinition = FeatureDefinitionSchema.parse(active.json);
  const next = structuredClone(def) as FeatureDefinition;
  const latest = await migratorDb.featureDefinitionVersion.findFirstOrThrow({
    where: { definitionId: row.id },
    orderBy: { version: "desc" },
  });

  const decision = next.steps.at(-1)!;
  const from = decision.key;
  const to = `decision_v${latest.version + 1}`;
  decision.key = to;
  decision.label = `Decision (v${latest.version + 1})`;
  next.steps
    .flatMap((s) => (s.kind === "parallel" ? [s] : []))
    .forEach((group) => {
      if (group.onComplete === "$next") return;
      group.onComplete = to;
    });
  // a rename is not only a step: everything that named the old state moves with it
  const rename = (states?: string[]) => states?.map((s) => (s === from ? to : s));
  for (const view of next.listViews) if (view.where?.states) view.where.states = rename(view.where.states)!;
  for (const counter of next.dashboardCounters)
    if (counter.where.states) counter.where.states = rename(counter.where.states)!;
  const draft = await migratorDb.featureDefinitionVersion.create({
    data: {
      definitionId: row.id,
      version: latest.version + 1,
      status: "draft",
      json: next as never,
      jsonHash: jsonHash(next),
      lockedHash: lockedHash(next, true),
      changeNote: "renamed the decision step",
      createdBy: admin.userId,
    },
  });
  await withTenantBypass(bypass, "publish a new version", (tx) =>
    publishVersionOn(tx, row.id, draft.id, { userId: admin.userId, isAdmin: true }),
  );
  return { versionId: draft.id, previousId: active.id, from, to };
}

async function fileRequest() {
  return withTenantTx(DEPT_CS, (tx) =>
    createRecord(tx, DEPT_CS, instructor, "generic_request", {
      data: { subject: "Projector", details: "Room 201 has no projector", urgency: "routine" },
    }),
  );
}

beforeAll(async () => {
  instructor = await actorFor("instructor1.cs@deptts.local");
  admin = await actorFor("admin@deptts.local");
});

describe("versions and migrations", () => {
  it("leaves running records on the version they were created on", async () => {
    const record = await fileRequest();
    const before = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });

    const { versionId, previousId } = await publishRenamed();
    expect(versionId).not.toBe(previousId);

    const after = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(after.definitionVersionId).toBe(before.definitionVersionId);
    // and it still acts on its own version: `request` is a step of v1 as much as of v2
    await withTenantTx(DEPT_CS, (tx) => act(tx, record.id, "request", "submit", instructor));
    expect(
      (await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } }))
        .currentStateKey,
    ).toBe("review");
  });

  it("plans a migration: counts per state, what was added, removed and blocked", async () => {
    const record = await fileRequest();
    const pinned = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    const renamed = await publishRenamed();
    const row = await definition();

    const plan = await withTenantBypass(bypass, "plan", (tx) =>
      planMigration(tx, DEPT_CS, row.id, pinned.definitionVersionId, row.activeVersionId!, {
        [renamed.from]: renamed.to,
      }),
    );
    expect(plan.byState.request).toBeGreaterThan(0);
    expect(plan.removedStates).toContain(renamed.from);
    expect(plan.addedStates).toContain(renamed.to);
    expect(plan.recordsTotal).toBeGreaterThan(0);
  });

  it("moves the records in batches and is a no-op when it runs again", async () => {
    const record = await fileRequest();
    const pinned = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    const renamed = await publishRenamed();
    const row = await definition();

    const migration = await withTenantBypass(bypass, "create migration", (tx) =>
      createMigration(tx, {
        departmentId: DEPT_CS,
        definitionId: row.id,
        fromVersionId: pinned.definitionVersionId,
        toVersionId: row.activeVersionId!,
        stateMap: { [renamed.from]: renamed.to },
        startedBy: admin.userId,
      }),
    );

    const first = await withTenantBypass(bypass, "migrate", (tx) =>
      runMigrationBatch(tx, migration.id, 50),
    );
    expect(first.migrated).toBeGreaterThan(0);
    expect(first.done).toBe(true);

    const moved = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(moved.definitionVersionId).toBe(row.activeVersionId);
    const log = await migratorDb.workflowTransitionLog.findFirst({
      where: { instanceId: moved.workflowInstanceId, transitionKey: "migrate" },
    });
    expect(log).not.toBeNull();

    const again = await withTenantBypass(bypass, "migrate again", (tx) =>
      runMigrationBatch(tx, migration.id, 50),
    );
    expect(again.migrated).toBe(0);
    expect(again.done).toBe(true);
  });

  it("blocks a record whose state has nowhere to go and leaves it on its version", async () => {
    const record = await fileRequest();
    const row = await definition();
    const pinned = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });

    const migration = await withTenantBypass(bypass, "create migration", (tx) =>
      createMigration(tx, {
        departmentId: DEPT_CS,
        definitionId: row.id,
        fromVersionId: pinned.definitionVersionId,
        toVersionId: row.activeVersionId!,
        stateMap: { request: BLOCK },
        startedBy: admin.userId,
      }),
    );
    const result = await withTenantBypass(bypass, "migrate", (tx) =>
      runMigrationBatch(tx, migration.id, 50),
    );
    expect(result.blocked).toBeGreaterThan(0);

    const still = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(still.definitionVersionId).toBe(pinned.definitionVersionId);
    const finished = await migratorDb.featureMigration.findUniqueOrThrow({
      where: { id: migration.id },
    });
    expect(finished.status).toBe("blocked");
    expect((finished.blockedIds as string[]) ?? []).toContain(record.id);
  });
});
