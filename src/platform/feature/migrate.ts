import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { record as audit } from "../audit/record";
import { FeatureDefinitionSchema, type FeatureDefinition } from "./schema";
import { buildTree } from "./tree";

// Moving running records onto a new version. Records pin the version they were created on, so a
// publish never disturbs them; when an administrator does want them moved, they say where each
// state goes and the records follow in batches. A state with no home blocks its records instead
// of guessing — a blocked record keeps working on its old version.

export const BLOCK = "$block";

export interface MigrationPlan {
  fromVersion: number;
  toVersion: number;
  /** How many records sit in each current state. */
  byState: Record<string, number>;
  /** States the map sends to `$block`, or does not mention at all. */
  blockedStates: string[];
  addedStates: string[];
  removedStates: string[];
  warnings: string[];
  recordsTotal: number;
  recordsBlocked: number;
}

async function versions(tx: Db, fromVersionId: string, toVersionId: string) {
  const [from, to] = await Promise.all([
    tx.featureDefinitionVersion.findUniqueOrThrow({ where: { id: fromVersionId } }),
    tx.featureDefinitionVersion.findUniqueOrThrow({ where: { id: toVersionId } }),
  ]);
  return {
    from,
    to,
    fromDef: FeatureDefinitionSchema.parse(from.json) as FeatureDefinition,
    toDef: FeatureDefinitionSchema.parse(to.json) as FeatureDefinition,
  };
}

function stateKeys(def: FeatureDefinition): string[] {
  const tree = buildTree(def);
  return [
    ...tree.leaves.map((l) => l.step.key),
    ...tree.parallels.map((p) => p.group.key),
    ...def.terminalStates.map((t) => t.key),
  ];
}

/** What a migration would do, without doing it. */
export async function planMigration(
  tx: Db,
  departmentId: string,
  definitionId: string,
  fromVersionId: string,
  toVersionId: string,
  stateMap: Record<string, string> = {},
): Promise<MigrationPlan> {
  const { from, to, fromDef, toDef } = await versions(tx, fromVersionId, toVersionId);
  const before = stateKeys(fromDef);
  const after = new Set(stateKeys(toDef));

  const counts = await tx.featureRecord.groupBy({
    by: ["currentStateKey"],
    where: { departmentId, definitionId, definitionVersionId: fromVersionId },
    _count: { _all: true },
  });
  const byState = Object.fromEntries(counts.map((c) => [c.currentStateKey, c._count._all]));

  const blockedStates: string[] = [];
  const warnings: string[] = [];
  for (const state of Object.keys(byState)) {
    const target = stateMap[state] ?? (after.has(state) ? state : undefined);
    if (!target || target === BLOCK) {
      blockedStates.push(state);
      continue;
    }
    if (!after.has(target)) {
      blockedStates.push(state);
      warnings.push(`"${state}" is mapped to "${target}", which the new version does not have`);
    }
  }

  const recordsTotal = Object.values(byState).reduce((n, c) => n + c, 0);
  const recordsBlocked = blockedStates.reduce((n, state) => n + (byState[state] ?? 0), 0);

  return {
    fromVersion: from.version,
    toVersion: to.version,
    byState,
    blockedStates,
    addedStates: [...after].filter((s) => !before.includes(s)),
    removedStates: before.filter((s) => !after.has(s)),
    warnings,
    recordsTotal,
    recordsBlocked,
  };
}

export interface MigrationInput {
  departmentId: string;
  definitionId: string;
  fromVersionId: string;
  toVersionId: string;
  stateMap: Record<string, string>;
  stepMap?: Record<string, string>;
  startedBy: string;
}

export async function createMigration(tx: Db, input: MigrationInput) {
  const plan = await planMigration(
    tx,
    input.departmentId,
    input.definitionId,
    input.fromVersionId,
    input.toVersionId,
    input.stateMap,
  );
  return tx.featureMigration.create({
    data: {
      departmentId: input.departmentId,
      definitionId: input.definitionId,
      fromVersionId: input.fromVersionId,
      toVersionId: input.toVersionId,
      stateMap: toJson(input.stateMap),
      stepMap: toJson(input.stepMap ?? {}),
      plan: toJson(plan),
      status: "planned",
      recordsTotal: plan.recordsTotal,
      startedBy: input.startedBy,
    },
  });
}

export interface BatchResult {
  migrated: number;
  blocked: number;
  remaining: number;
  done: boolean;
}

/**
 * Moves up to `size` records. The batch re-selects records that still point at the old version,
 * so running it again after a crash neither skips nor repeats one.
 */
export async function runMigrationBatch(
  tx: Db,
  migrationId: string,
  size = 200,
): Promise<BatchResult> {
  const migration = await tx.featureMigration.findUniqueOrThrow({ where: { id: migrationId } });
  const stateMap = (migration.stateMap ?? {}) as Record<string, string>;
  const stepMap = (migration.stepMap ?? {}) as Record<string, string>;
  const blockedIds = new Set<string>(((migration.blockedIds ?? []) as string[]) ?? []);
  const { toDef } = await versions(tx, migration.fromVersionId, migration.toVersionId);
  const after = new Set(stateKeys(toDef));

  if (migration.status === "planned")
    await tx.featureMigration.update({
      where: { id: migrationId },
      data: { status: "running", startedAt: new Date() },
    });

  const records = await tx.featureRecord.findMany({
    where: {
      departmentId: migration.departmentId,
      definitionId: migration.definitionId,
      definitionVersionId: migration.fromVersionId,
      id: { notIn: Array.from(blockedIds) },
    },
    take: size,
    orderBy: { createdAt: "asc" },
  });

  let migrated = 0;
  for (const record of records) {
    const target = stateMap[record.currentStateKey] ?? record.currentStateKey;
    if (target === BLOCK || !after.has(target)) {
      blockedIds.add(record.id);
      continue;
    }

    const instance = await tx.workflowInstance.findUnique({
      where: { id: record.workflowInstanceId },
    });
    const branchStates = mapBranchStates(instance?.branchStates as Record<string, { state: string }> | null, stateMap);

    await tx.workflowTransitionLog.create({
      data: {
        departmentId: record.departmentId,
        instanceId: record.workflowInstanceId,
        transitionKey: "migrate",
        fromState: record.currentStateKey,
        toState: target,
        actorUserId: migration.startedBy === "system" ? null : migration.startedBy,
        payloadJson: toJson({
          fromVersion: migration.fromVersionId,
          toVersion: migration.toVersionId,
          stateMap,
        }),
      },
    });
    await tx.workflowInstance.update({
      where: { id: record.workflowInstanceId },
      data: {
        currentState: target,
        ...(branchStates ? { branchStates: toJson(branchStates) } : {}),
      },
    });
    await tx.featureRecord.update({
      where: { id: record.id },
      data: {
        definitionVersionId: migration.toVersionId,
        currentStateKey: target,
        ...(branchStates ? { branchStatesCache: toJson(branchStates) } : {}),
      },
    });

    for (const [oldKey, newKey] of Object.entries(stepMap))
      await tx.featureStepInstance.updateMany({
        where: { recordId: record.id, stepKey: oldKey },
        data: { stepKey: newKey },
      });

    migrated += 1;
  }

  const remaining = await tx.featureRecord.count({
    where: {
      departmentId: migration.departmentId,
      definitionId: migration.definitionId,
      definitionVersionId: migration.fromVersionId,
      id: { notIn: Array.from(blockedIds) },
    },
  });
  const done = remaining === 0;

  await tx.featureMigration.update({
    where: { id: migrationId },
    data: {
      recordsMigrated: migration.recordsMigrated + migrated,
      recordsBlocked: blockedIds.size,
      blockedIds: toJson(Array.from(blockedIds)),
      ...(done ? { status: blockedIds.size ? "blocked" : "done", finishedAt: new Date() } : {}),
    },
  });

  if (done)
    await audit(tx, {
      action: "update",
      subjectType: "feature_definition",
      subjectId: migration.definitionId,
      departmentId: migration.departmentId,
      reason: `migrated ${migration.recordsMigrated + migrated} record(s), ${blockedIds.size} blocked`,
    });

  return { migrated, blocked: blockedIds.size, remaining, done };
}

function mapBranchStates(
  branchStates: Record<string, { state: string }> | null,
  stateMap: Record<string, string>,
): Record<string, unknown> | null {
  if (!branchStates) return null;
  return Object.fromEntries(
    Object.entries(branchStates).map(([key, branch]) => [
      key,
      { ...branch, state: stateMap[branch.state] ?? branch.state },
    ]),
  );
}
