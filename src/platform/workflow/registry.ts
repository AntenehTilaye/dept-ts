import { toJson } from "../../lib/db/json";
import { globalSingleton } from "../../lib/singleton";
import { prismaRoot } from "../../lib/db/prisma";
import { withTenantBypass, withTenantTx } from "../../lib/db/tenant";
import type { Db } from "../../lib/db/types";
import { parseDefinition, WorkflowDefinitionInput, type Definition } from "./schema";
import { validateDefinition } from "./validate";

// Definition storage with validation and a per-process cache keyed by row id (rows are immutable
// once active). Faculty-wide definitions (departmentId NULL) are written under bypass.

export class InvalidDefinitionError extends Error {
  constructor(public readonly issues: ReturnType<typeof validateDefinition>) {
    super(
      `Invalid workflow definition: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
    this.name = "InvalidDefinitionError";
  }
}

export interface DefinitionRow {
  id: string;
  departmentId: string | null;
  key: string;
  version: number;
  status: string;
  definition: Definition;
}

const cache = globalSingleton("workflow-definitions", () => new Map<string, DefinitionRow>());

export function clearDefinitionCache(): void {
  cache.clear();
}

function toRow(row: {
  id: string;
  departmentId: string | null;
  key: string;
  version: number;
  status: string;
  subjectType: string;
  initialState: string;
  statesJson: unknown;
  transitionsJson: unknown;
}): DefinitionRow {
  return {
    id: row.id,
    departmentId: row.departmentId,
    key: row.key,
    version: row.version,
    status: row.status,
    definition: parseDefinition(row),
  };
}

/**
 * Creates the next version of a definition (or the given version) after validation. New
 * versions start `active` and retire the previous active version of the same key/scope.
 */
export async function upsertDefinition(
  raw: unknown,
  opts: { createdBy?: string | null; activate?: boolean } = {},
): Promise<DefinitionRow> {
  const input = WorkflowDefinitionInput.parse(raw);
  const def: Definition = {
    key: input.key,
    version: input.version ?? 1,
    subjectType: input.subjectType,
    initialState: input.initialState,
    states: input.states,
    transitions: input.transitions,
  };
  const issues = validateDefinition(def);
  if (issues.length) throw new InvalidDefinitionError(issues);
  const activate = opts.activate ?? true;

  const write = async (tx: Db) => {
    const latest = await tx.workflowDefinition.findFirst({
      where: { key: input.key, departmentId: input.departmentId },
      orderBy: { version: "desc" },
    });
    const version = input.version ?? (latest ? latest.version + 1 : 1);
    if (activate) {
      await tx.workflowDefinition.updateMany({
        where: { key: input.key, departmentId: input.departmentId, status: "active" },
        data: { status: "retired" },
      });
    }
    const row = await tx.workflowDefinition.create({
      data: {
        departmentId: input.departmentId,
        key: input.key,
        version,
        subjectType: input.subjectType as never,
        initialState: input.initialState,
        statesJson: toJson(input.states),
        transitionsJson: toJson(input.transitions),
        lockedPathsJson: toJson(input.lockedPaths),
        isSystem: input.isSystem,
        status: activate ? "active" : "draft",
        featureVersionId: input.featureVersionId,
        createdBy: opts.createdBy ?? null,
      },
    });
    return toRow(row);
  };
  const row = input.departmentId
    ? await withTenantTx(input.departmentId, write)
    : await withTenantBypass(
        { worker: true, jobName: "workflow.definition" },
        "faculty workflow definition",
        write,
      );
  cache.set(row.id, row);
  return row;
}

export async function definitionById(db: Db, id: string): Promise<DefinitionRow> {
  const hit = cache.get(id);
  if (hit) return hit;
  const row = await db.workflowDefinition.findUniqueOrThrow({ where: { id } });
  const parsed = toRow(row);
  cache.set(id, parsed);
  return parsed;
}

/** The active definition for a key: the department's own row wins over the faculty-wide one. */
export async function activeDefinition(
  db: Db,
  key: string,
  departmentId: string | null,
): Promise<DefinitionRow | null> {
  const rows = await db.workflowDefinition.findMany({
    where: { key, status: "active", OR: [{ departmentId }, { departmentId: null }] },
    orderBy: { version: "desc" },
  });
  const row =
    rows.find((r) => r.departmentId === departmentId) ?? rows.find((r) => r.departmentId === null);
  if (!row) return null;
  const parsed = toRow(row);
  cache.set(parsed.id, parsed);
  return parsed;
}

export async function listDefinitions(db: Db = prismaRoot) {
  return db.workflowDefinition.findMany({
    select: {
      id: true,
      departmentId: true,
      key: true,
      version: true,
      status: true,
      subjectType: true,
      isSystem: true,
      featureVersionId: true,
      createdAt: true,
      _count: { select: { instances: true } },
    },
    orderBy: [{ key: "asc" }, { version: "desc" }],
  });
}

export async function versionsOf(db: Db, key: string) {
  const rows = await db.workflowDefinition.findMany({
    where: { key },
    orderBy: { version: "desc" },
  });
  return rows.map(toRow);
}
