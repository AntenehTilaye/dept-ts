import type { Db } from "../../lib/db/types";
import type { Actor } from "../identity/can";
import { actorRoleKeys } from "./nav";
import { FeatureDefinitionSchema, type Counter, type FeatureDefinition } from "./schema";

// Dashboard and sidebar counts. They are grouped queries over the records themselves — there is
// no counter cache to fall out of date, and `current_state_key` is indexed per department and
// definition for exactly this.

export interface CounterResult {
  featureKey: string;
  key: string;
  label: string;
  count: number;
  href: string;
  tone: "neutral" | "warning" | "danger";
}

export async function featureCounters(
  tx: Db,
  departmentId: string,
  actor: Actor | null,
  deptSlug: string,
): Promise<CounterResult[]> {
  const roles = await actorRoleKeys(tx, actor);
  const definitions = await tx.featureDefinition.findMany({
    where: { OR: [{ departmentId }, { departmentId: null }], activeVersionId: { not: null } },
  });
  const versions = await tx.featureDefinitionVersion.findMany({
    where: { id: { in: definitions.map((d) => d.activeVersionId!) } },
  });
  const jsonById = new Map(versions.map((v) => [v.id, v.json]));

  const out: CounterResult[] = [];
  for (const definition of definitions) {
    const raw = jsonById.get(definition.activeVersionId!);
    if (!raw) continue;
    const def: FeatureDefinition = FeatureDefinitionSchema.parse(raw);
    for (const counter of def.dashboardCounters) {
      if (!counter.roles.some((role) => roles.includes(role)) && !roles.includes("admin")) continue;
      out.push({
        featureKey: def.key,
        key: counter.key,
        label: counter.label,
        count: await countFor(tx, departmentId, definition.id, counter, actor),
        href: `/d/${deptSlug}/f/${def.key}?view=${counter.link}`,
        tone: counter.tone,
      });
    }
  }
  return out;
}

async function countFor(
  tx: Db,
  departmentId: string,
  definitionId: string,
  counter: Counter,
  actor: Actor | null,
): Promise<number> {
  const where = counter.where;
  return tx.featureRecord.count({
    where: {
      departmentId,
      definitionId,
      ...(where.states?.length ? { currentStateKey: { in: where.states } } : {}),
      ...(where.presetKey ? { presetKey: where.presetKey } : {}),
      ...(where.ownedByMe && actor?.personId ? { ownerPersonId: actor.personId } : {}),
      ...(where.overdue ? { deadlineAt: { lt: new Date() }, closedAt: null } : {}),
      ...(where.assignedToMe && actor?.personId
        ? {
            steps: {
              some: { status: "active", assigneeType: "person", assigneeId: actor.personId },
            },
          }
        : {}),
    },
  });
}

/** Count per state for one feature, for the list page's filter chips. */
export async function countsByState(
  tx: Db,
  departmentId: string,
  definitionId: string,
): Promise<Record<string, number>> {
  const rows = await tx.featureRecord.groupBy({
    by: ["currentStateKey"],
    where: { departmentId, definitionId },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.currentStateKey, r._count._all]));
}
