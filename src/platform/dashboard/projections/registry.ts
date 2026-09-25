import { globalSingleton } from "../../../lib/singleton";
import { toJson } from "../../../lib/db/json";
import type { Db } from "../../../lib/db/types";

// A projection is a question somebody asks every time they open a page, answered once and kept.
// It is written forward by the events that change it and rebuildable from the tables it came
// from, and the two paths have to agree — which is the one thing the tests insist on.

export interface ProjectionEvent {
  name: string;
  departmentId: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export interface ProjectionRow {
  rowKey: string;
  dimensions?: Record<string, unknown>;
  values: Record<string, number>;
}

export interface ProjectionDef {
  key: string;
  /** Domain events after which this projection may be out of date. */
  events: string[];
  /** Applies one event; returns the rows it changed, or nothing when it does not care. */
  apply: (event: ProjectionEvent, tx: Db) => Promise<ProjectionRow[] | void>;
  /** Builds every row of a department from the tables themselves. */
  rebuild: (departmentId: string, tx: Db) => Promise<ProjectionRow[]>;
}

const projections = globalSingleton("dashboard-projections", () => new Map<string, ProjectionDef>());

export function registerProjection(definition: ProjectionDef): void {
  projections.set(definition.key, definition);
}

export function getProjection(key: string): ProjectionDef | undefined {
  return projections.get(key);
}

export function listProjections(): ProjectionDef[] {
  return Array.from(projections.values());
}

/** Writes rows of one projection. Idempotent: the same row written twice is one row. */
export async function writeRows(
  tx: Db,
  departmentId: string,
  projectionKey: string,
  rows: ProjectionRow[],
): Promise<number> {
  for (const row of rows) {
    const data = {
      departmentId,
      dimensionsJson: toJson(row.dimensions ?? {}),
      valuesJson: toJson(row.values),
    };
    await tx.dashboardProjection.upsert({
      where: { projectionKey_rowKey: { projectionKey, rowKey: row.rowKey } },
      update: data,
      create: { projectionKey, rowKey: row.rowKey, ...data },
    });
  }
  return rows.length;
}

/** Runs every projection that cares about an event. Called inside the outbox's own transaction. */
export async function applyEvent(tx: Db, event: ProjectionEvent): Promise<void> {
  for (const projection of projections.values()) {
    if (!projection.events.includes(event.name)) continue;
    const rows = await projection.apply(event, tx);
    if (rows?.length) await writeRows(tx, event.departmentId, projection.key, rows);
  }
}

export interface RebuildSummary {
  projectionKey: string;
  rows: number;
}

/** Rebuilds projections from the tables. What it writes is what the live path should hold. */
export async function rebuildProjections(
  tx: Db,
  departmentId: string,
  keys?: string[],
): Promise<RebuildSummary[]> {
  const out: RebuildSummary[] = [];
  for (const projection of projections.values()) {
    if (keys?.length && !keys.includes(projection.key)) continue;
    const rows = await projection.rebuild(departmentId, tx);
    // the department's rows of this projection are replaced wholesale, so a row whose subject
    // is gone does not linger
    await tx.dashboardProjection.deleteMany({
      where: { departmentId, projectionKey: projection.key },
    });
    await writeRows(tx, departmentId, projection.key, rows);
    out.push({ projectionKey: projection.key, rows: rows.length });
  }
  return out;
}

/** Reads one projection's rows for a department. */
export async function readProjection(
  tx: Db,
  departmentId: string,
  projectionKey: string,
): Promise<{ rowKey: string; dimensions: Record<string, unknown>; values: Record<string, number> }[]> {
  const rows = await tx.dashboardProjection.findMany({
    where: { departmentId, projectionKey },
    orderBy: { rowKey: "asc" },
  });
  return rows.map((row) => ({
    rowKey: row.rowKey,
    dimensions: (row.dimensionsJson ?? {}) as Record<string, unknown>,
    values: (row.valuesJson ?? {}) as Record<string, number>,
  }));
}
