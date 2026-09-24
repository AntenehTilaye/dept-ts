import type { PermissionLevel } from "@/generated/prisma/enums";
import { toJson } from "../../lib/db/json";
import { withTenantBypass } from "../../lib/db/tenant";
import type { Db } from "../../lib/db/types";
import { record as audit } from "../audit/record";
import { publish as emit } from "../audit/outbox";
import { defineForm, latestVersion, newVersion } from "../forms/definitions";
import { upsertDefinition } from "../workflow/registry";
import { adapterHooks } from "./adapters/registry";
import { compile, type CompiledFeature } from "./compile";
import { allLocks, jsonHash, lockedHash } from "./locks";
import { FeatureDefinitionSchema, type FeatureDefinition } from "./schema";
import { errorsOnly, validateDefinition, type Issue, type ValidationContext } from "./validate";

// Publishing is the only moment a definition becomes real. It happens in one transaction: the
// workflow definition, the per-step forms and the permission rows are written together with the
// version row that points at them, so a half-published feature cannot exist. Running records are
// untouched — they stay pinned to the version they were created on.

export class PublishError extends Error {
  constructor(
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message);
    this.name = "PublishError";
  }
}

export interface PublishActor {
  userId: string;
  isAdmin?: boolean;
}

export interface PublishOptions {
  /** Skip the checks that need the surrounding world (used by the seed, which knows it is right). */
  context?: ValidationContext;
  changeNote?: string;
}

/** The validation context built from what the database currently offers. */
export async function publishContext(
  db: Db,
  definitionId: string,
  isSystem: boolean,
  /** A key is taken only within its own scope: a department definition shadows the faculty one. */
  departmentId: string | null = null,
): Promise<ValidationContext> {
  const [features, forms, templates, schedules, roles] = await Promise.all([
    db.featureDefinition.findMany({
      select: { id: true, key: true, activeVersionId: true, departmentId: true },
    }),
    db.formDefinition.findMany({ where: { status: "published" }, select: { key: true } }),
    db.template.findMany({ select: { key: true } }),
    db.reminderSchedule.findMany({ select: { key: true } }),
    db.role.findMany({ select: { key: true } }),
  ]);
  return {
    isSystem,
    takenKeys: features
      .filter((f) => f.id !== definitionId && f.departmentId === departmentId)
      .map((f) => f.key),
    publishedFeatures: features.filter((f) => f.activeVersionId).map((f) => ({ key: f.key })),
    publishedForms: Array.from(new Set(forms.map((f) => f.key))),
    templateKeys: Array.from(new Set(templates.map((t) => t.key))),
    scheduleKeys: Array.from(new Set(schedules.map((s) => s.key))),
    roleKeys: Array.from(new Set([...roles.map((r) => r.key), "admin"])),
    adapters: adapterHooks(),
  };
}

export interface PublishResult {
  versionId: string;
  version: number;
  workflowDefinitionId: string;
  compiled: CompiledFeature;
}

/**
 * Validates, compiles and writes every artefact of one version, then points the definition at
 * it. Faculty-wide definitions are written under an audited bypass, since they have no
 * department of their own.
 */
export async function publishVersion(
  definitionId: string,
  versionId: string,
  actor: PublishActor,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  return withTenantBypass(
    { isAdmin: true, user: { id: actor.userId } },
    `publish feature version ${versionId}`,
    async (tx) => publishVersionOn(tx, definitionId, versionId, actor, opts),
  );
}

/** The same work on a transaction the caller already owns (the seed runs several in a row). */
export async function publishVersionOn(
  tx: Db,
  definitionId: string,
  versionId: string,
  actor: PublishActor,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const definition = await tx.featureDefinition.findUniqueOrThrow({ where: { id: definitionId } });
  const version = await tx.featureDefinitionVersion.findUniqueOrThrow({ where: { id: versionId } });
  if (version.definitionId !== definitionId)
    throw new PublishError("That version belongs to another feature");

  const def: FeatureDefinition = FeatureDefinitionSchema.parse(version.json);
  const previous = definition.activeVersionId
    ? await tx.featureDefinitionVersion.findUnique({ where: { id: definition.activeVersionId } })
    : null;

  // the locks say what an administrator may not move; a deployment is the other author, so a
  // version the seed produced is published without comparing them
  const fromSeed = (version.changeNote ?? "").startsWith("seed");
  const ctx: ValidationContext = {
    ...(opts.context ?? (await publishContext(tx, definitionId, definition.isSystem, definition.departmentId))),
    isSystem: definition.isSystem,
    ...(previous && previous.id !== versionId && !fromSeed
      ? { previous: { json: previous.json, locks: allLocks(def, definition.isSystem) } }
      : {}),
  };

  const issues = validateDefinition(def, ctx);
  const errors = errorsOnly(issues);
  if (errors.length)
    throw new PublishError(
      `"${def.key}" cannot be published: ${errors.map((e) => `${e.code} at ${e.path}`).join(", ")}`,
      errors,
    );

  const compiled = compile(def, {
    isSystem: definition.isSystem,
    departmentId: definition.departmentId,
  });

  // 1. the workflow, pointed back at this version
  const workflow = await upsertDefinition(
    { ...compiled.workflow, featureVersionId: versionId, departmentId: definition.departmentId },
    { createdBy: actor.userId, activate: true, tx },
  );

  // 2. the forms: a new version only when the questions actually changed
  const forms: Record<string, { key: string; id: string; version: number }> = {};
  for (const [stepKey, form] of Object.entries(compiled.forms)) {
    if (form.reuseFormKey) {
      const existing = await latestVersion(tx, form.reuseFormKey, definition.departmentId);
      if (existing) forms[stepKey] = { key: existing.key, id: existing.id, version: existing.version };
      continue;
    }
    const existing = await latestVersion(tx, form.key, definition.departmentId);
    const row = existing
      ? await newVersion(tx, form.key, form.fields, {
          departmentId: definition.departmentId,
          title: form.title,
          createdBy: actor.userId,
          publish: true,
        })
      : await defineForm(tx, {
          key: form.key,
          kind: form.kind,
          title: form.title,
          fields: form.fields,
          isSystem: definition.isSystem,
          departmentId: definition.departmentId,
          createdBy: actor.userId,
          publish: true,
        });
    forms[stepKey] = { key: row.key, id: row.id, version: row.version };
  }

  // 3. permissions and the default matrix rows for this feature
  await writePermissions(tx, def, compiled, definition.departmentId);

  // 4. the version becomes the active one
  const publishedAt = new Date();
  await tx.featureDefinitionVersion.update({
    where: { id: versionId },
    data: {
      status: "published",
      compiledJson: toJson({ ...compiled, forms: { ...compiled.forms }, formVersions: forms }),
      jsonHash: jsonHash(def),
      lockedHash: lockedHash(def, definition.isSystem),
      workflowDefinitionId: workflow.id,
      publishedAt,
      publishedBy: actor.userId,
      ...(opts.changeNote ? { changeNote: opts.changeNote } : {}),
    },
  });
  if (previous && previous.id !== versionId)
    await tx.featureDefinitionVersion.update({
      where: { id: previous.id },
      data: { status: (await pinnedCount(tx, previous.id)) ? "published" : "retired" },
    });
  await tx.featureDefinition.update({
    where: { id: definitionId },
    data: {
      activeVersionId: versionId,
      name: def.name,
      description: def.description ?? null,
      icon: def.navigation.icon,
      navGroup: def.navigation.group,
      navOrder: def.navigation.order,
    },
  });

  await audit(tx, {
    action: "publish",
    subjectType: "feature_definition",
    subjectId: definitionId,
    departmentId: definition.departmentId,
    actorUserId: actor.userId,
    reason: `v${version.version} of ${def.key}`,
  });
  await emit(
    tx,
    "feature.published",
    { subjectType: "feature_definition", subjectId: definitionId },
    { key: def.key, version: version.version, departmentId: definition.departmentId },
    { departmentId: definition.departmentId },
  );

  return { versionId, version: version.version, workflowDefinitionId: workflow.id, compiled };
}

async function pinnedCount(tx: Db, versionId: string): Promise<number> {
  return tx.featureRecord.count({ where: { definitionVersionId: versionId } });
}

/** Permission rows for the feature's own keys; a key another module owns is left alone. */
async function writePermissions(
  tx: Db,
  def: FeatureDefinition,
  compiled: CompiledFeature,
  departmentId: string | null,
): Promise<void> {
  for (const key of compiled.permissionKeys) {
    const [module = "feature", ...rest] = key.split(".");
    await tx.permission.upsert({
      where: { key },
      create: {
        key,
        module,
        action: rest.join(".") || "act",
        description: `${def.name}: ${rest.join(".") || key}`,
        isSystem: false,
      },
      update: {},
    });
  }

  const roles = await tx.role.findMany({ where: { departmentId: null } });
  const roleByKey = new Map(roles.map((r) => [r.key, r.id]));
  for (const row of compiled.rolePermissions) {
    const roleId = roleByKey.get(row.roleKey);
    // `admin` is the global user.role, not a Role row
    if (!roleId) continue;
    const existing = await tx.rolePermission.findFirst({
      where: { departmentId, roleId, permissionKey: row.permissionKey },
    });
    if (existing) {
      if (existing.level !== row.level)
        await tx.rolePermission.update({
          where: { id: existing.id },
          data: { level: row.level as PermissionLevel },
        });
      continue;
    }
    await tx.rolePermission.create({
      data: {
        departmentId,
        roleId,
        permissionKey: row.permissionKey,
        level: row.level as PermissionLevel,
      },
    });
  }
}

/** Retires a version; refuses while records still render from it. */
export async function retireVersion(tx: Db, versionId: string): Promise<void> {
  const pinned = await pinnedCount(tx, versionId);
  if (pinned)
    throw new PublishError(`${pinned} record${pinned === 1 ? "" : "s"} still use this version`);
  await tx.featureDefinitionVersion.update({ where: { id: versionId }, data: { status: "retired" } });
}
