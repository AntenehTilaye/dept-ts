import { describe, expect, it } from "vitest";
import { compile } from "@/platform/feature/compile";
import { deriveImplicitLocks, lockedHash } from "@/platform/feature/locks";
import { FeatureDefinitionSchema } from "@/platform/feature/schema";
import { simulate } from "@/platform/feature/simulate";
import { errorsOnly, validateDefinition } from "@/platform/feature/validate";
import { SEED_FEATURES } from "../../../prisma/seed/features";
import { caseFeature } from "../../../prisma/seed/features/case";
import { genericRequest } from "../../../prisma/seed/features/generic_request";
import { task } from "../../../prisma/seed/features/task";

// The built-ins are ordinary definitions, so the same checks apply to them: they parse, they
// validate, they compile to the artefacts the runtime expects, and a run of each one behaves the
// way the process is supposed to. A seed that breaks any of this fails here, not in production.

const ADAPTERS: Record<string, string> = {
  "task.requiredDeliverablesLinked": "guard",
  "task.setCompletedAt": "effect",
  "case.subscribeIntervalNudge": "on_enter",
  "case.cancelNudge": "on_exit",
  "case.setResolvedAt": "effect",
  "case.autoClose": "effect",
};

describe("the seeded features", () => {
  it("every built-in parses and validates without an error", () => {
    for (const definition of SEED_FEATURES) {
      const def = FeatureDefinitionSchema.parse(definition);
      const issues = errorsOnly(validateDefinition(def, { isSystem: true, adapters: ADAPTERS }));
      expect({ key: def.key, issues }).toEqual({ key: def.key, issues: [] });
    }
  });

  it("compiles `task` into the lifecycle the work-item service already runs", () => {
    const compiled = compile(task, { isSystem: true });
    expect(compiled.workflow.key).toBe("feature:task");
    expect(compiled.workflow.states.map((s) => s.key)).toEqual([
      "draft",
      "assigned",
      "in_progress",
      "submitted",
      "under_review",
      "revision_required",
      "completed",
      "cancelled",
    ]);
    expect(compiled.workflow.initialState).toBe("draft");
    // the record IS the task, so no step spawns another one
    expect(Object.values(compiled.taskTemplates).every((t) => !t.createTask)).toBe(true);
    const submit = compiled.workflow.transitions.find((t) => t.key === "in_progress.submit")!;
    expect(submit.guards).toEqual([
      "feature.actorAllowed",
      "feature.stepComplete",
      "task.requiredDeliverablesLinked",
    ]);
    const approve = compiled.workflow.transitions.find((t) => t.key === "under_review.approve")!;
    expect(approve.effects.map((e) => e.kind)).toContain("invokeHandler");
    expect(approve.to).toBe("completed");
    // every state except the terminals can be cancelled
    const cancellable = compiled.workflow.transitions.filter((t) => t.action === "cancel");
    expect(cancellable).toHaveLength(6);
  });

  it("gives `task` one preset per kind, each fixing the kind of the record", () => {
    const def = FeatureDefinitionSchema.parse(task);
    expect(Object.keys(def.presets)).toContain("committee_task");
    expect(def.presets.committee_task).toMatchObject({
      fieldDefaults: { kind: "committee_task" },
      parentSubjectType: "committee",
    });
  });

  it("compiles `generic_request` into a parallel review with a quorum of one", () => {
    const compiled = compile(genericRequest, { isSystem: true });
    const review = compiled.workflow.states.find((s) => s.key === "review")!;
    expect(review.compound).toMatchObject({
      completion: { rule: "quorum", n: 1 },
      onComplete: "decision",
      onReject: "rejected",
    });
    expect(review.compound!.branches.map((b) => b.key)).toEqual(["deputy", "committee"]);
    // the branch steps are states of their branch, never of the record
    expect(compiled.workflow.states.map((s) => s.key)).not.toContain("deputy_review");
    expect(compiled.workflow.transitions.find((t) => t.key === "review.$join")).toBeDefined();
    expect(compiled.workflow.transitions.find((t) => t.key === "review.$reject")).toBeDefined();
    expect(Object.keys(compiled.reminderTemplates).sort()).toEqual([
      "committee_review",
      "decision",
      "deputy_review",
    ]);
  });

  it("compiles `case` with its interval nudge, its automatic close and its locks", () => {
    const compiled = compile(caseFeature, { isSystem: true });
    expect(compiled.autoTriggers.resolved).toEqual([
      {
        stepKey: "resolved",
        actionKey: "auto_close",
        transitionKey: "resolved.auto_close",
        when: "after_days",
        settingKey: "case.autoCloseDays",
      },
    ]);
    const locks = deriveImplicitLocks(FeatureDefinitionSchema.parse(caseFeature));
    expect(locks).toContain("/record/backing");
    expect(locks).toContain("/steps/1/adapter");
    expect(locks).toContain("/presets/general/fieldDefaults");
  });

  it("hashes each built-in's locked subtree stably", () => {
    for (const definition of SEED_FEATURES) {
      const def = FeatureDefinitionSchema.parse(definition);
      expect(lockedHash(def, true)).toBe(lockedHash(FeatureDefinitionSchema.parse(definition), true));
    }
  });

  it("runs a request through `generic_request` the way the process reads", () => {
    const trace = simulate(genericRequest, {
      actor: {
        personId: "sim",
        roles: ["instructor", "deputy_head", "department_head"],
        grantRoleKeys: [],
        relationships: ["owner", "creator", "assignee"],
      },
      record: { subject: "A projector", details: "for Lab A" },
      path: [
        { stepKey: "request", actionKey: "submit" },
        { stepKey: "deputy_review", branchKey: "deputy", actionKey: "endorse" },
        { stepKey: "decision", actionKey: "approve" },
      ],
    });
    expect(trace.states).toEqual(["request", "review", "decision", "approved"]);
    expect(trace.steps.map((s) => s.stepKey)).toEqual([
      "request",
      "deputy_review",
      "committee_review",
      "decision",
    ]);
    expect(errorsOnly(trace.issues)).toEqual([]);
  });

  it("refuses the whole request when one reviewer refuses", () => {
    const trace = simulate(genericRequest, {
      actor: {
        personId: "sim",
        roles: ["instructor", "committee_member"],
        grantRoleKeys: [],
        relationships: ["owner", "creator", "assignee"],
      },
      record: { subject: "A projector", details: "for Lab A" },
      path: [
        { stepKey: "request", actionKey: "submit" },
        {
          stepKey: "committee_review",
          branchKey: "committee",
          actionKey: "refuse",
          comment: "Not this year",
        },
      ],
    });
    expect(trace.states.at(-1)).toBe("rejected");
  });
});
