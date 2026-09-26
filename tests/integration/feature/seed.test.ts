import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantBypass } from "@/lib/db/tenant";
import { adapterHooks, allLocks, lockedPathsChanged } from "@/platform/feature";
import { seedFeature } from "@/platform/feature/seed";
import { FeatureDefinitionSchema, type FeatureDefinitionInput, type StepDefInput } from "@/platform/feature/schema";
import { SEED_FEATURES } from "../../../prisma/seed/features";
import { committee } from "../../../prisma/seed/features/committee";
import { committeeReport } from "../../../prisma/seed/features/committee_report";
import { genericRequest } from "../../../prisma/seed/features/generic_request";
import { migratorDb } from "../../setup/db";

// The contract that lets a system feature be edited: a deployment owns the locked subtree, the
// administrator owns the rest, and neither silently overwrites the other.

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

const bypass = { worker: true as const, jobName: "test" };
const clone = (): FeatureDefinitionInput => structuredClone(genericRequest);

async function definitionOf(key: string) {
  return migratorDb.featureDefinition.findFirstOrThrow({ where: { key, departmentId: null } });
}

beforeAll(async () => {
  // the minimal seed has already run; this is the state every case starts from
  await definitionOf("generic_request");
});

describe("seeding the built-in features", () => {
  it("seeds every built-in once and is a no-op the second time", async () => {
    const before = await migratorDb.featureDefinitionVersion.count();
    for (const definition of SEED_FEATURES) {
      const outcome = await withTenantBypass(bypass, "re-seed", (tx) => seedFeature(tx, definition));
      expect(outcome.action).toBe("unchanged");
    }
    expect(await migratorDb.featureDefinitionVersion.count()).toBe(before);
  });

  it("publishes each built-in with a workflow, its forms and its permission rows", async () => {
    const definition = await definitionOf("generic_request");
    const version = await migratorDb.featureDefinitionVersion.findUniqueOrThrow({
      where: { id: definition.activeVersionId! },
    });
    expect(version.status).toBe("published");
    expect(version.changeNote).toMatch(/^seed:/);
    expect(version.workflowDefinitionId).not.toBeNull();

    const workflow = await migratorDb.workflowDefinition.findUniqueOrThrow({
      where: { id: version.workflowDefinitionId! },
    });
    expect(workflow.key).toBe("feature:generic_request");
    expect(workflow.status).toBe("active");
    expect(workflow.featureVersionId).toBe(version.id);

    const form = await migratorDb.formDefinition.findFirst({
      where: { key: "generic_request.record", status: "published" },
    });
    expect(form).not.toBeNull();

    const permission = await migratorDb.permission.findUnique({
      where: { key: "feature.generic_request.act.approve" },
    });
    expect(permission).not.toBeNull();
    const rows = await migratorDb.rolePermission.findMany({
      where: { permissionKey: "feature.generic_request.view", departmentId: null },
      include: { role: { select: { key: true } } },
    });
    expect(rows.map((r) => r.role.key)).toContain("department_head");
  });

  it("keeps an administrator's edit to an unlocked label when the code has not moved", async () => {
    const definition = await definitionOf("generic_request");
    const active = await migratorDb.featureDefinitionVersion.findUniqueOrThrow({
      where: { id: definition.activeVersionId! },
    });
    const edited = structuredClone(active.json) as Record<string, unknown>;
    (edited.labels as Record<string, string>).plural = "Departmental requests";
    await migratorDb.featureDefinitionVersion.update({
      where: { id: active.id },
      data: { json: edited as never },
    });

    const outcome = await withTenantBypass(bypass, "re-seed", (tx) =>
      seedFeature(tx, genericRequest),
    );
    expect(outcome.action).toBe("unchanged");
    const after = await migratorDb.featureDefinitionVersion.findUniqueOrThrow({
      where: { id: active.id },
    });
    expect((after.json as { labels: { plural: string } }).labels.plural).toBe(
      "Departmental requests",
    );
    await migratorDb.featureDefinitionVersion.update({
      where: { id: active.id },
      data: { json: active.json as never },
    });
  });

  it("leaves a merged seed-upgrade draft when a locked value changes in the code", async () => {
    const definition = await definitionOf("generic_request");
    const before = await migratorDb.featureDefinitionVersion.findUniqueOrThrow({
      where: { id: definition.activeVersionId! },
    });

    // the administrator renamed a step (unlocked) ...
    const edited = structuredClone(before.json) as FeatureDefinitionInput;
    (edited.steps as StepDefInput[])[0]!.label = "File the request";
    await migratorDb.featureDefinitionVersion.update({
      where: { id: before.id },
      data: { json: edited as never },
    });

    // ... and a release adds a guard, which is locked
    const withGuard = clone();
    (withGuard.steps as StepDefInput[])[0]!.actions[0]!.guards = [
      "task.requiredDeliverablesLinked",
    ];
    const outcome = await withTenantBypass(bypass, "seed upgrade", (tx) =>
      seedFeature(tx, withGuard),
    );
    // SEED_AUTO_PUBLISH=1 in the test service, so the upgrade is published straight away
    expect(outcome.action).toBe("published_upgrade");

    const after = await definitionOf("generic_request");
    const version = await migratorDb.featureDefinitionVersion.findUniqueOrThrow({
      where: { id: after.activeVersionId! },
    });
    expect(version.version).toBe(before.version + 1);
    expect(version.changeNote).toMatch(/^seed-upgrade:/);
    const merged = FeatureDefinitionSchema.parse(version.json);
    // the code's locked guard arrived, the administrator's label stayed
    expect((merged.steps[0] as { actions: { guards: string[] }[] }).actions[0]!.guards).toEqual([
      "task.requiredDeliverablesLinked",
    ]);
    expect((merged.steps[0] as { label: string }).label).toBe("File the request");

    // restore the seeded definition for the rest of the suite
    await withTenantBypass(bypass, "restore", (tx) => seedFeature(tx, genericRequest));
  });

  it("refuses a locked edit to a module feature, and publishes it with its module's rows", async () => {
    const definition = await definitionOf("committee_report");
    const version = await migratorDb.featureDefinitionVersion.findUniqueOrThrow({
      where: { id: definition.activeVersionId! },
    });
    expect(version.status).toBe("published");
    const parsed = FeatureDefinitionSchema.parse(version.json);

    // what the code owns in this definition: the rows it names have to exist in TypeScript
    const locks = allLocks(parsed, true);
    expect(locks).toContain("/record/backing");
    expect(locks).toContain("/steps/0/actions/0/guards");
    expect(locks).toContain("/steps/0/actions/0/effects");

    // an administrator may rename the step ...
    const renamed = structuredClone(parsed) as FeatureDefinitionInput;
    (renamed.steps as StepDefInput[])[0]!.label = "Being drafted";
    expect(lockedPathsChanged(parsed, renamed, locks)).toEqual([]);

    // ... but not take the membership guard off the submission
    const ungarded = structuredClone(parsed) as FeatureDefinitionInput;
    (ungarded.steps as StepDefInput[])[0]!.actions[0]!.guards = [];
    const changed = lockedPathsChanged(parsed, ungarded, locks);
    expect(changed.map((c) => c.path)).toContain("/steps/0/actions/0/guards");
  });

  it("gives the committee features the workflow, the forms and the permissions they declare", async () => {
    for (const key of ["committee", "committee_report"]) {
      const definition = await definitionOf(key);
      const version = await migratorDb.featureDefinitionVersion.findUniqueOrThrow({
        where: { id: definition.activeVersionId! },
      });
      const workflow = await migratorDb.workflowDefinition.findUniqueOrThrow({
        where: { id: version.workflowDefinitionId! },
      });
      expect(workflow.key).toBe(`feature:${key}`);
      expect(workflow.status).toBe("active");
    }
    // the report's own questions are a published form, so a record pins the version it was written in
    const form = await migratorDb.formDefinition.findFirst({
      where: { key: "committee_report.draft", status: "published" },
    });
    expect(form).not.toBeNull();
    // and the two explicit permission keys are the module's, not generated ones
    for (const key of ["committee.report.submit", "committee.manage"])
      expect(await migratorDb.permission.findUnique({ where: { key } })).not.toBeNull();
  });

  it("re-seeds the committee features without writing a new version", async () => {
    const before = await migratorDb.featureDefinitionVersion.count();
    for (const definition of [committee, committeeReport]) {
      const outcome = await withTenantBypass(bypass, "re-seed", (tx) =>
        seedFeature(tx, definition),
      );
      expect(outcome.action).toBe("unchanged");
    }
    expect(await migratorDb.featureDefinitionVersion.count()).toBe(before);
  });

  it("registers every adapter a seeded definition names, with the hook it is used as", async () => {
    const hooks = adapterHooks();
    const rows = await migratorDb.adapterRegistration.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r.hook]));

    expect(byKey.get("feature.actorAllowed")).toBe("guard");
    expect(byKey.get("task.requiredDeliverablesLinked")).toBe("guard");
    expect(byKey.get("task.setCompletedAt")).toBe("effect");
    expect(byKey.get("case.subscribeIntervalNudge")).toBe("on_enter");
    expect(byKey.get("committee.backing")).toBe("backing");
    expect(byKey.get("committee.memberGuard")).toBe("guard");
    expect(byKey.get("committee.escalateIssueToCase")).toBe("effect");

    for (const [key, hook] of Object.entries(hooks)) expect(byKey.get(key)).toBe(hook);
  });
});
