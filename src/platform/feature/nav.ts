import type { Db } from "../../lib/db/types";
import type { Actor } from "../identity/can";
import { FeatureDefinitionSchema, type FeatureDefinition, type NavGroup } from "./schema";

// The sidebar is a query, not a file. Every published feature says where it belongs, in which
// order and to whom; a department definition shadows the faculty one by key, so a department
// that customised its own version of a process still gets one entry.

export interface NavEntry {
  key: string;
  label: string;
  icon: string;
  group: NavGroup;
  order: number;
  href: string;
  /** Preset entries of the same feature (campaign kinds, task kinds). */
  presetKey?: string;
  showCounter: boolean;
}

/** Role keys the actor holds in this department, membership and derived alike. */
export async function actorRoleKeys(tx: Db, actor: Actor | null): Promise<string[]> {
  if (!actor) return [];
  const now = new Date();
  const grants = await tx.roleGrant.findMany({
    where: {
      userId: actor.userId,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    include: { role: { select: { key: true } } },
  });
  const keys = grants.map((g) => g.role.key);
  return actor.isAdmin ? Array.from(new Set([...keys, "admin"])) : Array.from(new Set(keys));
}

export interface NavOptions {
  deptSlug: string;
  roles?: string[];
}

export async function getNav(
  tx: Db,
  departmentId: string,
  actor: Actor | null,
  opts: NavOptions,
): Promise<NavEntry[]> {
  const roles = opts.roles ?? (await actorRoleKeys(tx, actor));
  const definitions = await tx.featureDefinition.findMany({
    where: { OR: [{ departmentId }, { departmentId: null }], activeVersionId: { not: null } },
    orderBy: [{ navGroup: "asc" }, { navOrder: "asc" }],
  });

  // a department row shadows the faculty one with the same key
  const byKey = new Map<string, (typeof definitions)[number]>();
  for (const definition of definitions) {
    const current = byKey.get(definition.key);
    if (!current || definition.departmentId) byKey.set(definition.key, definition);
  }

  const versions = await tx.featureDefinitionVersion.findMany({
    where: { id: { in: Array.from(byKey.values()).map((d) => d.activeVersionId!) } },
  });
  const jsonById = new Map(versions.map((v) => [v.id, v.json]));

  const entries: NavEntry[] = [];
  for (const definition of byKey.values()) {
    const raw = jsonById.get(definition.activeVersionId!);
    if (!raw) continue;
    const def: FeatureDefinition = FeatureDefinitionSchema.parse(raw);
    if (!visible(def.navigation.visibleRoles, roles)) continue;

    const base = `/d/${opts.deptSlug}/f/${def.key}`;
    entries.push({
      key: def.key,
      label: def.labels.plural,
      icon: def.navigation.icon,
      group: def.navigation.group,
      order: def.navigation.order,
      href: base,
      showCounter: def.navigation.showCounterInNav,
    });

    // a preset with its own label is its own entry: "Evaluations" next to "Surveys"
    for (const [presetKey, preset] of Object.entries(def.presets)) {
      if (!preset.navLabel) continue;
      if (preset.visibleRoles && !visible(preset.visibleRoles, roles)) continue;
      entries.push({
        key: `${def.key}:${presetKey}`,
        label: preset.navLabel,
        icon: def.navigation.icon,
        group: def.navigation.group,
        order: def.navigation.order + 0.5,
        href: `${base}?preset=${presetKey}`,
        presetKey,
        showCounter: false,
      });
    }
  }

  return entries.sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order);
}

function visible(visibleRoles: string[], roles: string[]): boolean {
  if (roles.includes("admin")) return true;
  return visibleRoles.some((role) => roles.includes(role));
}
