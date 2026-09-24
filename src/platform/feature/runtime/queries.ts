import type { Db } from "../../../lib/db/types";
import { compile, type CompiledFeature } from "../compile";
import { FeatureDefinitionSchema, type FeatureDefinition, type ListView, type StepDef } from "../schema";
import { buildTree, type Tree } from "../tree";

// Everything the runtime and the pages read. A record renders from the version it was created
// on, never from the newest one, so publishing a change never moves a record that is already in
// flight — which is why every read here starts from `definitionVersionId`.

export class FeatureNotFoundError extends Error {
  constructor(key: string) {
    super(`No published feature "${key}"`);
    this.name = "FeatureNotFoundError";
  }
}

export interface ResolvedDefinition {
  definitionId: string;
  versionId: string;
  version: number;
  key: string;
  departmentId: string | null;
  isSystem: boolean;
  def: FeatureDefinition;
  compiled: CompiledFeature;
  tree: Tree;
}

function parse(row: {
  id: string;
  definitionId: string;
  version: number;
  json: unknown;
}, definition: { key: string; departmentId: string | null; isSystem: boolean }): ResolvedDefinition {
  const def = FeatureDefinitionSchema.parse(row.json);
  return {
    definitionId: row.definitionId,
    versionId: row.id,
    version: row.version,
    key: definition.key,
    departmentId: definition.departmentId,
    isSystem: definition.isSystem,
    def,
    compiled: compile(def, { isSystem: definition.isSystem, departmentId: definition.departmentId }),
    tree: buildTree(def),
  };
}

/**
 * The active definition of a key for one department: a department row shadows the faculty one.
 * `feature_definition` is SHARED, so the caller's transaction already limits what is visible.
 */
export async function getDefinition(
  db: Db,
  departmentId: string,
  key: string,
): Promise<ResolvedDefinition> {
  const candidates = await db.featureDefinition.findMany({
    where: { key, OR: [{ departmentId }, { departmentId: null }] },
  });
  const definition =
    candidates.find((c) => c.departmentId === departmentId) ??
    candidates.find((c) => c.departmentId === null);
  if (!definition?.activeVersionId) throw new FeatureNotFoundError(key);
  const version = await db.featureDefinitionVersion.findUniqueOrThrow({
    where: { id: definition.activeVersionId },
  });
  return parse(version, definition);
}

/** The version a record is pinned to. */
export async function definitionOfRecord(
  db: Db,
  record: { definitionId: string; definitionVersionId: string },
): Promise<ResolvedDefinition> {
  const [definition, version] = await Promise.all([
    db.featureDefinition.findUniqueOrThrow({ where: { id: record.definitionId } }),
    db.featureDefinitionVersion.findUniqueOrThrow({ where: { id: record.definitionVersionId } }),
  ]);
  return parse(version, definition);
}

export async function getRecord(db: Db, recordId: string) {
  return db.featureRecord.findUnique({
    where: { id: recordId },
    include: { steps: { orderBy: [{ enteredAt: "asc" }] } },
  });
}

export async function activeSteps(db: Db, recordId: string) {
  return db.featureStepInstance.findMany({
    where: { recordId, status: "active" },
    orderBy: { enteredAt: "asc" },
  });
}

export function stepOf(resolved: ResolvedDefinition, stepKey: string): StepDef | undefined {
  return resolved.tree.byKey[stepKey]?.step;
}

export function listViewOf(def: FeatureDefinition, key?: string | null): ListView {
  return def.listViews.find((v) => v.key === key) ?? def.listViews[0]!;
}

export interface ListFilters {
  states?: string[];
  presetKey?: string;
  parentRef?: { subjectType: string; subjectId: string };
  mine?: boolean;
  overdue?: boolean;
  assignedTo?: string;
  search?: string;
  take?: number;
  skip?: number;
}

/** Records of one feature in one department, filtered the way the list view asks. */
export async function listRecords(
  db: Db,
  departmentId: string,
  resolved: Pick<ResolvedDefinition, "definitionId" | "def">,
  view: ListView,
  filters: ListFilters = {},
  personId?: string | null,
) {
  const states = filters.states ?? view.where?.states;
  const presetKey = filters.presetKey ?? view.where?.presetKey;
  const assignedTo = filters.assignedTo ?? (filters.mine ? (personId ?? undefined) : undefined);

  return db.featureRecord.findMany({
    where: {
      departmentId,
      definitionId: resolved.definitionId,
      ...(states?.length ? { currentStateKey: { in: states } } : {}),
      ...(presetKey ? { presetKey } : {}),
      ...(filters.parentRef
        ? {
            parentSubjectType: filters.parentRef.subjectType as never,
            parentSubjectId: filters.parentRef.subjectId,
          }
        : {}),
      ...(filters.overdue ? { deadlineAt: { lt: new Date() }, closedAt: null } : {}),
      ...(assignedTo
        ? {
            steps: {
              some: { status: "active", assigneeType: "person", assigneeId: assignedTo },
            },
          }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { title: { contains: filters.search, mode: "insensitive" as const } },
              { number: { contains: filters.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy:
      view.defaultSort.field === "createdAt"
        ? { createdAt: view.defaultSort.dir }
        : view.defaultSort.field === "deadline"
          ? { deadlineAt: view.defaultSort.dir }
          : { number: view.defaultSort.dir },
    include: { steps: { where: { status: "active" } } },
    take: filters.take ?? 100,
    skip: filters.skip ?? 0,
  });
}

/** The step page's read model: the step, its instance, the form to render and the answers. */
export async function getStepContext(
  db: Db,
  recordId: string,
  stepKey: string,
  branchKey?: string | null,
) {
  const record = await db.featureRecord.findUniqueOrThrow({ where: { id: recordId } });
  const resolved = await definitionOfRecord(db, record);
  const step = stepOf(resolved, stepKey);
  if (!step) throw new FeatureNotFoundError(`${resolved.key}.${stepKey}`);
  const instance = await db.featureStepInstance.findFirst({
    where: { recordId, stepKey, ...(branchKey ? { branchKey } : {}) },
    orderBy: { sequence: "desc" },
  });
  const submission = instance?.submissionId
    ? await db.submission.findUnique({
        where: { id: instance.submissionId },
        include: { answers: true },
      })
    : null;
  return { record, resolved, step, instance, submission };
}
