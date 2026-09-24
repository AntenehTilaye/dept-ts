import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantBypass, withTenantTx } from "@/lib/db/tenant";
import type { Actor } from "@/platform/identity/can";
import { createRecord, publishVersionOn } from "@/platform/feature";
import { jsonHash, lockedHash } from "@/platform/feature/locks";
import { createMigration } from "@/platform/feature/migrate";
import { FeatureDefinitionSchema, type FeatureDefinition } from "@/platform/feature/schema";
import featureMigrate from "../../apps/worker/src/handlers/feature-migrate";
import { migratorDb, withDept } from "../setup/db";
import { DEPT_CS } from "../setup/seed-minimal";
import * as f from "../setup/factories";
import { awaitJob, startTestBoss } from "../setup/boss";

// The migration job moves records in batches and re-queues itself while there is more to do, so a
// long migration survives a restart: each batch re-selects what still points at the old version.

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

const bypass = { worker: true as const, jobName: "test" };
let boss: PgBoss;
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

async function publishRenamedVersion(): Promise<{ from: string; to: string }> {
  const definition = await migratorDb.featureDefinition.findFirstOrThrow({
    where: { key: "generic_request", departmentId: null },
  });
  const active = await migratorDb.featureDefinitionVersion.findUniqueOrThrow({
    where: { id: definition.activeVersionId! },
  });
  const latest = await migratorDb.featureDefinitionVersion.findFirstOrThrow({
    where: { definitionId: definition.id },
    orderBy: { version: "desc" },
  });
  const next = structuredClone(
    FeatureDefinitionSchema.parse(active.json) as FeatureDefinition,
  ) as FeatureDefinition;

  const last = next.steps.at(-1)!;
  const from = last.key;
  const to = `decision_w${latest.version + 1}`;
  last.key = to;
  for (const node of next.steps) if (node.kind === "parallel" && node.onComplete === from) node.onComplete = to;
  const rename = (states?: string[]) => states?.map((s) => (s === from ? to : s));
  for (const view of next.listViews) if (view.where?.states) view.where.states = rename(view.where.states)!;
  for (const counter of next.dashboardCounters)
    if (counter.where.states) counter.where.states = rename(counter.where.states)!;

  const draft = await migratorDb.featureDefinitionVersion.create({
    data: {
      definitionId: definition.id,
      version: latest.version + 1,
      status: "draft",
      json: next as never,
      jsonHash: jsonHash(next),
      lockedHash: lockedHash(next, true),
      changeNote: "renamed for the worker test",
      createdBy: admin.userId,
    },
  });
  await withTenantBypass(bypass, "publish", (tx) =>
    publishVersionOn(tx, definition.id, draft.id, { userId: admin.userId, isAdmin: true }),
  );
  return { from, to };
}

beforeAll(async () => {
  boss = await startTestBoss([featureMigrate]);
  instructor = await actorFor("instructor1.cs@deptts.local");
  admin = await actorFor("admin@deptts.local");
});

afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
});

describe("the feature.migrate job", () => {
  it("moves every record of a department and finishes the migration row", async () => {
    const records = await Promise.all(
      [1, 2, 3].map((n) =>
        withTenantTx(DEPT_CS, (tx) =>
          createRecord(tx, DEPT_CS, instructor, "generic_request", {
            data: { subject: `Batch ${n}`, details: "moved by the worker", urgency: "routine" },
          }),
        ),
      ),
    );
    const pinned = await migratorDb.featureRecord.findUniqueOrThrow({
      where: { id: records[0]!.id },
    });
    const { from, to } = await publishRenamedVersion();
    const definition = await migratorDb.featureDefinition.findFirstOrThrow({
      where: { key: "generic_request", departmentId: null },
    });

    const migration = await withTenantBypass(bypass, "create migration", (tx) =>
      createMigration(tx, {
        departmentId: DEPT_CS,
        definitionId: definition.id,
        fromVersionId: pinned.definitionVersionId,
        toVersionId: definition.activeVersionId!,
        stateMap: { [from]: to },
        startedBy: admin.userId,
      }),
    );

    const jobId = await boss.send("feature.migrate", {
      migrationId: migration.id,
      departmentId: DEPT_CS,
      batchSize: 2,
    });
    await awaitJob(boss, "feature.migrate", jobId!);

    // the first batch re-queued itself; run the remaining batches the same way the worker does
    for (let i = 0; i < 5; i += 1) {
      const row = await migratorDb.featureMigration.findUniqueOrThrow({ where: { id: migration.id } });
      if (row.status === "done" || row.status === "blocked") break;
      await featureMigrate.handle(
        [{ data: { migrationId: migration.id, departmentId: DEPT_CS, batchSize: 2 } } as never],
        { boss },
      );
    }

    const finished = await migratorDb.featureMigration.findUniqueOrThrow({
      where: { id: migration.id },
    });
    expect(finished.status).toBe("done");
    expect(finished.recordsMigrated).toBeGreaterThanOrEqual(records.length);
    for (const record of records) {
      const moved = await migratorDb.featureRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(moved.definitionVersionId).toBe(definition.activeVersionId);
    }
  });

  it("running the job again after it finished changes nothing", async () => {
    const migration = await migratorDb.featureMigration.findFirstOrThrow({
      orderBy: { startedAt: "desc" },
    });
    const before = await migratorDb.featureMigration.findUniqueOrThrow({
      where: { id: migration.id },
    });
    await featureMigrate.handle(
      [{ data: { migrationId: migration.id, departmentId: DEPT_CS } } as never],
      { boss },
    );
    const after = await migratorDb.featureMigration.findUniqueOrThrow({
      where: { id: migration.id },
    });
    expect(after.recordsMigrated).toBe(before.recordsMigrated);
  });
});
