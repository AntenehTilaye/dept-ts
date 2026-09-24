"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { toJson } from "@/lib/db/json";
import { withTenantBypass } from "@/lib/db/tenant";
import {
  FeatureDefinitionSchema,
  allLocks,
  assertLockedPathsUnchanged,
  createMigration,
  jsonHash,
  lockedHash,
  planMigration,
  publishVersionOn,
  publishContext,
  scopeTypeOf,
  simulate,
  validateDefinition,
  type FeatureDefinition,
} from "@/platform/feature";
import { enqueue } from "@/platform/scheduler/enqueue";

// The builder's server actions. Saving a draft, validating, simulating and publishing are
// separate steps on purpose: an administrator sees what a change would do before any record is
// affected, and a locked pointer is refused at save time rather than at publish time.

const bypassFor = (userId: string) => ({ isAdmin: true as const, user: { id: userId } });

const DefinitionJson = z.string().transform((raw, ctx) => {
  try {
    return FeatureDefinitionSchema.parse(JSON.parse(raw));
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message.slice(0, 400) : "invalid definition",
    });
    return z.NEVER;
  }
});

/** Creates a definition from a JSON document (the wizard's "clone" and "import" paths). */
export const createFeatureAction = adminAction(
  z.object({ json: DefinitionJson, publish: z.string().optional() }),
  async ({ input, ctx }) => {
    const def = input.json as FeatureDefinition;
    return withTenantBypass(bypassFor(ctx.user.id), `create feature ${def.key}`, async (tx) => {
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
          isSystem: false,
          createdBy: ctx.user.id,
        },
      });
      const version = await tx.featureDefinitionVersion.create({
        data: {
          definitionId: definition.id,
          version: 1,
          status: "draft",
          json: toJson(def),
          jsonHash: jsonHash(def),
          lockedHash: lockedHash(def, false),
          changeNote: "created in the builder",
          createdBy: ctx.user.id,
        },
      });
      if (input.publish === "1")
        await publishVersionOn(tx, definition.id, version.id, {
          userId: ctx.user.id,
          isAdmin: true,
        });
      revalidatePath("/admin/features");
      return { key: def.key, definitionId: definition.id, versionId: version.id };
    });
  },
);

/** Saves the draft of a definition, refusing any change to a pointer the code owns. */
export const saveDraftAction = adminAction(
  z.object({ definitionId: z.string().min(1), json: DefinitionJson, changeNote: z.string().optional() }),
  async ({ input, ctx }) => {
    const def = input.json as FeatureDefinition;
    return withTenantBypass(bypassFor(ctx.user.id), `save feature draft`, async (tx) => {
      const definition = await tx.featureDefinition.findUniqueOrThrow({
        where: { id: input.definitionId },
      });
      const active = definition.activeVersionId
        ? await tx.featureDefinitionVersion.findUnique({
            where: { id: definition.activeVersionId },
          })
        : null;
      if (active && definition.isSystem)
        assertLockedPathsUnchanged(active.json, def, allLocks(def, true));

      const draft = await tx.featureDefinitionVersion.findFirst({
        where: { definitionId: definition.id, status: "draft" },
        orderBy: { version: "desc" },
      });
      const latest = await tx.featureDefinitionVersion.findFirstOrThrow({
        where: { definitionId: definition.id },
        orderBy: { version: "desc" },
      });

      const row = draft
        ? await tx.featureDefinitionVersion.update({
            where: { id: draft.id },
            data: {
              json: toJson(def),
              jsonHash: jsonHash(def),
              lockedHash: lockedHash(def, definition.isSystem),
              changeNote: input.changeNote ?? draft.changeNote,
            },
          })
        : await tx.featureDefinitionVersion.create({
            data: {
              definitionId: definition.id,
              version: latest.version + 1,
              status: "draft",
              json: toJson(def),
              jsonHash: jsonHash(def),
              lockedHash: lockedHash(def, definition.isSystem),
              changeNote: input.changeNote ?? "edited in the builder",
              createdBy: ctx.user.id,
            },
          });
      revalidatePath(`/admin/features/${definition.key}`);
      return { versionId: row.id, version: row.version };
    });
  },
);

/** Validates a document against everything the database currently offers. */
export const validateDraftAction = adminAction(
  z.object({ definitionId: z.string().min(1), json: DefinitionJson }),
  async ({ input, ctx }) => {
    const def = input.json as FeatureDefinition;
    return withTenantBypass(bypassFor(ctx.user.id), "validate a feature", async (tx) => {
      const definition = await tx.featureDefinition.findUniqueOrThrow({
        where: { id: input.definitionId },
      });
      const context = await publishContext(
        tx,
        definition.id,
        definition.isSystem,
        definition.departmentId,
      );
      return { issues: validateDefinition(def, context) };
    });
  },
);

/** Runs a scripted path through the definition without writing anything. */
export const simulateDraftAction = adminAction(
  z.object({
    json: DefinitionJson,
    script: z.string().transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        ctx.addIssue({ code: "custom", message: "the script is not valid JSON" });
        return z.NEVER;
      }
    }),
  }),
  async ({ input }) => {
    const script = input.script as never;
    return { trace: simulate(input.json, script) };
  },
);

export const publishVersionAction = adminAction(
  z.object({ definitionId: z.string().min(1), versionId: z.string().min(1) }),
  async ({ input, ctx }) => {
    const result = await withTenantBypass(
      bypassFor(ctx.user.id),
      `publish feature version ${input.versionId}`,
      (tx) =>
        publishVersionOn(tx, input.definitionId, input.versionId, {
          userId: ctx.user.id,
          isAdmin: true,
        }),
    );
    revalidatePath("/admin/features");
    return { version: result.version };
  },
);

export const planMigrationAction = adminAction(
  z.object({
    definitionId: z.string().min(1),
    departmentId: z.string().min(1),
    fromVersionId: z.string().min(1),
    toVersionId: z.string().min(1),
    stateMap: z.string().optional(),
  }),
  async ({ input, ctx }) => {
    const stateMap = input.stateMap ? (JSON.parse(input.stateMap) as Record<string, string>) : {};
    const plan = await withTenantBypass(bypassFor(ctx.user.id), "plan a migration", (tx) =>
      planMigration(
        tx,
        input.departmentId,
        input.definitionId,
        input.fromVersionId,
        input.toVersionId,
        stateMap,
      ),
    );
    return { plan };
  },
);

export const startMigrationAction = adminAction(
  z.object({
    definitionId: z.string().min(1),
    departmentId: z.string().min(1),
    fromVersionId: z.string().min(1),
    toVersionId: z.string().min(1),
    stateMap: z.string().optional(),
  }),
  async ({ input, ctx }) => {
    const stateMap = input.stateMap ? (JSON.parse(input.stateMap) as Record<string, string>) : {};
    const migration = await withTenantBypass(bypassFor(ctx.user.id), "start a migration", async (tx) => {
      const row = await createMigration(tx, {
        departmentId: input.departmentId,
        definitionId: input.definitionId,
        fromVersionId: input.fromVersionId,
        toVersionId: input.toVersionId,
        stateMap,
        startedBy: ctx.user.id,
      });
      await enqueue(
        tx,
        "feature.migrate",
        { migrationId: row.id, departmentId: input.departmentId },
        {
          kind: "feature_migrate",
          singletonKey: `feature-migrate:${row.id}`,
          departmentId: input.departmentId,
        },
      );
      return row;
    });
    revalidatePath("/admin/features");
    return { migrationId: migration.id, total: migration.recordsTotal };
  },
);

export async function createFeatureForm(fd: FormData) {
  return createFeatureAction(formToObject(fd));
}
export async function saveDraftForm(fd: FormData) {
  return saveDraftAction(formToObject(fd));
}
export async function publishVersionForm(fd: FormData) {
  return publishVersionAction(formToObject(fd));
}
export async function startMigrationForm(fd: FormData) {
  return startMigrationAction(formToObject(fd));
}
