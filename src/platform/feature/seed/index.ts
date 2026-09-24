import { env } from "../../../lib/env";
import { toJson } from "../../../lib/db/json";
import { withTenantBypass } from "../../../lib/db/tenant";
import type { Db } from "../../../lib/db/types";
import { adapterHooks } from "../adapters/registry";
import { allLocks, jsonHash, lockedHash } from "../locks";
import { publishVersionOn } from "../publish";
import { FeatureDefinitionSchema, scopeTypeOf, type FeatureDefinition } from "../schema";
import { errorsOnly, validateDefinition } from "../validate";
import { mergeLocked } from "./merge";

// Seeding the built-ins (design part 03 §9). The rule that makes this safe to run on every
// deployment: the seed owns the locked subtree and nothing else. A definition an administrator
// has edited is never overwritten — when the code's locked hash changes, the seed leaves a DRAFT
// that merges the new locked parts into their document, and the admin list shows "system update
// pending" until someone publishes it.

export interface SeedOutcome {
  key: string;
  action: "created" | "unchanged" | "upgraded" | "published_upgrade";
  versionId?: string;
}

const SEED_USER = "system";

export async function seedFeature(
  tx: Db,
  input: unknown,
  opts: { autoPublish?: boolean } = {},
): Promise<SeedOutcome> {
  const def: FeatureDefinition = FeatureDefinitionSchema.parse(input);
  const issues = errorsOnly(validateDefinition(def, { isSystem: true, adapters: adapterHooks() }));
  if (issues.length)
    throw new Error(
      `the seeded feature "${def.key}" is invalid: ${issues.map((i) => `${i.code} at ${i.path}`).join(", ")}`,
    );

  const codeLockedHash = lockedHash(def, true);
  const existing = await tx.featureDefinition.findFirst({
    where: { key: def.key, departmentId: null },
  });

  if (!existing) {
    const definition = await tx.featureDefinition.create({
      data: {
        key: def.key,
        departmentId: null,
        name: def.name,
        description: def.description ?? null,
        icon: def.navigation.icon,
        navGroup: def.navigation.group,
        navOrder: def.navigation.order,
        scopeLevel: scopeTypeOf(def.scope.level),
        isSystem: true,
        createdBy: SEED_USER,
      },
    });
    const version = await tx.featureDefinitionVersion.create({
      data: {
        definitionId: definition.id,
        version: 1,
        status: "draft",
        json: toJson(def),
        jsonHash: jsonHash(def),
        lockedHash: codeLockedHash,
        changeNote: `seed:${codeLockedHash}`,
        createdBy: SEED_USER,
      },
    });
    await publishVersionOn(tx, definition.id, version.id, { userId: SEED_USER, isAdmin: true });
    return { key: def.key, action: "created", versionId: version.id };
  }

  const active = existing.activeVersionId
    ? await tx.featureDefinitionVersion.findUnique({ where: { id: existing.activeVersionId } })
    : null;
  // nobody has edited this definition yet: every version it has came from a seed and its
  // document still hashes to what the seed wrote, so a release may improve it wholesale — a
  // renamed label or a new field reaches the installation instead of waiting for somebody to
  // notice. A document that no longer matches its own hash was edited, so it is protected.
  const untouched =
    !!active &&
    (active.changeNote ?? "").startsWith("seed") &&
    jsonHash(active.json) === active.jsonHash;
  const codeJsonHash = jsonHash(def);
  if (active?.lockedHash === codeLockedHash && (!untouched || active.jsonHash === codeJsonHash))
    return { key: def.key, action: "unchanged" };

  // the code moved: keep the administrator's document, take the locked subtree from the code
  const base = untouched ? def : (active?.json ?? def);
  const merged = untouched ? def : mergeLocked(base, def, allLocks(def, true));
  const latest = await tx.featureDefinitionVersion.findFirst({
    where: { definitionId: existing.id },
    orderBy: { version: "desc" },
  });
  const draft = await tx.featureDefinitionVersion.create({
    data: {
      definitionId: existing.id,
      version: (latest?.version ?? 0) + 1,
      status: "draft",
      json: toJson(merged),
      jsonHash: jsonHash(merged),
      lockedHash: codeLockedHash,
      changeNote: untouched ? `seed:${codeLockedHash}` : `seed-upgrade:${codeLockedHash}`,
      createdBy: SEED_USER,
    },
  });

  // an untouched definition has nobody's work to protect, so the new version goes live at once
  const autoPublish = untouched || (opts.autoPublish ?? env().SEED_AUTO_PUBLISH === "1");
  if (!autoPublish) return { key: def.key, action: "upgraded", versionId: draft.id };
  await publishVersionOn(tx, existing.id, draft.id, { userId: SEED_USER, isAdmin: true });
  return { key: def.key, action: "published_upgrade", versionId: draft.id };
}

/** Seeds every built-in, parents first; each in its own bypass transaction. */
export async function seedFeatures(
  definitions: unknown[],
  opts: { autoPublish?: boolean } = {},
): Promise<SeedOutcome[]> {
  const out: SeedOutcome[] = [];
  for (const definition of definitions)
    out.push(
      await withTenantBypass(
        { worker: true, jobName: "seed" },
        `seed feature ${(definition as { key?: string }).key ?? "?"}`,
        (tx) => seedFeature(tx, definition, opts),
      ),
    );
  return out;
}

/** Whether a definition is waiting for an administrator to publish a seed upgrade. */
export async function pendingSystemUpgrade(tx: Db, definitionId: string): Promise<boolean> {
  const draft = await tx.featureDefinitionVersion.findFirst({
    where: { definitionId, status: "draft", changeNote: { startsWith: "seed-upgrade:" } },
  });
  return !!draft;
}

export { mergeLocked } from "./merge";
