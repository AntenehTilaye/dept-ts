import { describe, expect, it } from "vitest";
import { compile } from "@/platform/feature/compile";
import type { FeatureDefinitionInput, StepDefInput } from "@/platform/feature/schema";
import { minimalDefinition } from "../../fixtures/feature-definitions/minimal";

// The compiler is the contract between the builder and every other kernel, so these assertions
// are about the artefacts themselves: the states a record can be in, the transitions that move
// it, and the task, form, reminder and permission rows the runtime will use.

const steps = (def: FeatureDefinitionInput) => def.steps as StepDefInput[];

function withParallel(mode: "static" | "dynamic" = "static"): FeatureDefinitionInput {
  const def = minimalDefinition();
  const [request, approval] = steps(def);
  const branchStep = (key: string, label: string): StepDefInput => ({
    ...approval!,
    key,
    label,
    actions: [
      { key: "approve", label: "Approve", kind: "approve", to: "$next", actors: [{ type: "assignee" }] },
      {
        key: "reject",
        label: "Reject",
        kind: "reject",
        to: "rejected",
        actors: [{ type: "assignee" }],
        requiredComment: true,
      },
    ],
  });
  def.steps = [
    request!,
    mode === "static"
      ? {
          kind: "parallel",
          key: "reviews",
          label: "Reviews",
          branches: {
            mode: "static",
            items: [
              { key: "head", label: "Head", steps: [branchStep("head_review", "Head review")] },
              { key: "deputy", label: "Deputy", steps: [branchStep("deputy_review", "Deputy review")] },
            ],
          },
          completion: { rule: "quorum", n: 1 },
          onComplete: "approved",
          onAnyReject: "rejected",
        }
      : {
          kind: "parallel",
          key: "circulation",
          label: "Circulation",
          branches: {
            mode: "dynamic",
            perPerson: { type: "role", roles: ["instructor"] },
            branch: { key: "review", label: "Review", steps: [branchStep("member_review", "Member review")] },
          },
          completion: { rule: "all" },
          onComplete: "approved",
        },
  ];
  return def;
}

describe("compile", () => {
  it("turns each leaf into a state and each action into one transition", () => {
    const compiled = compile(minimalDefinition());
    expect(compiled.workflow.key).toBe("feature:leave_request");
    expect(compiled.workflow.subjectType).toBe("feature_record");
    expect(compiled.workflow.initialState).toBe("request");
    expect(compiled.workflow.states.map((s) => [s.key, s.category])).toEqual([
      ["request", "initial"],
      ["approval", "active"],
      ["approved", "terminal"],
      ["rejected", "terminal"],
    ]);
    expect(compiled.workflow.transitions.map((t) => t.key)).toEqual([
      "request.submit",
      "approval.approve",
      "approval.reject",
    ]);

    const submit = compiled.workflow.transitions[0]!;
    expect(submit).toMatchObject({ from: "request", to: "approval", action: "submit" });
    expect(submit.guards).toEqual(["feature.actorAllowed", "feature.stepComplete"]);
    expect(submit.requiredPermission).toBe("feature.leave_request.act.submit");
    expect(submit.effects.map((e) => e.kind)).toEqual(["exitStep", "enterStep"]);

    const approve = compiled.workflow.transitions[1]!;
    expect(approve.effects.map((e) => e.kind)).toEqual(["exitStep", "setTerminal"]);
    expect(approve.effects[1]!.args).toMatchObject({ stateKey: "approved", category: "success" });
  });

  it("flattens a step group into consecutive states joined by `$next`", () => {
    const def = minimalDefinition();
    const [request, approval] = steps(def);
    def.steps = [
      request!,
      {
        kind: "group",
        key: "preparation",
        label: "Preparation",
        steps: [
          {
            kind: "step",
            key: "collect",
            label: "Collect",
            assignee: { type: "owner" },
            actions: [
              { key: "done", label: "Done", kind: "complete", to: "$next", actors: [{ type: "owner" }] },
            ],
          },
          {
            kind: "step",
            key: "check",
            label: "Check",
            assignee: { type: "owner" },
            actions: [
              { key: "done", label: "Done", kind: "complete", to: "$next", actors: [{ type: "owner" }] },
            ],
          },
        ],
      },
      approval!,
    ];

    const compiled = compile(def);
    expect(compiled.workflow.states.map((s) => s.key)).toEqual([
      "request",
      "collect",
      "check",
      "approval",
      "approved",
      "rejected",
    ]);
    // the group itself is never a state; it only orders its children
    expect(compiled.stateIndex.preparation).toBeUndefined();
    expect(compiled.nextMap).toMatchObject({ request: "collect", collect: "check", check: "approval" });
  });

  it("compiles a parallel group into one compound state with a branch spec per branch", () => {
    const compiled = compile(withParallel());
    const compound = compiled.workflow.states.find((s) => s.key === "reviews")!;
    expect(compound.category).toBe("waiting");
    expect(compound.compound).toMatchObject({
      completion: { rule: "quorum", n: 1 },
      dynamic: false,
      onComplete: "approved",
      onReject: "rejected",
    });
    expect(compound.compound!.branches.map((b) => b.key)).toEqual(["head", "deputy"]);
    expect(compound.compound!.branches[0]).toMatchObject({
      initialState: "head_review",
      doneState: "reviews.head.$done",
      rejectedState: "reviews.head.$rejected",
      states: ["head_review", "reviews.head.$done", "reviews.head.$rejected"],
    });
    expect(compound).not.toHaveProperty("joinPolicy");

    const keys = compiled.workflow.transitions.map((t) => t.key);
    expect(keys).toContain("reviews.$join");
    expect(keys).toContain("reviews.$reject");
    const join = compiled.workflow.transitions.find((t) => t.key === "reviews.$join")!;
    expect(join).toMatchObject({ from: "reviews", to: "approved", system: true });
    expect(join.guards).toEqual(["feature.parallelComplete"]);

    // a branch action carries its branch, finishes the branch and never leaves it
    const approve = compiled.workflow.transitions.find((t) => t.key === "head_review.approve")!;
    expect(approve).toMatchObject({ branch: "head", to: "reviews.head.$done" });
    expect(approve.effects.map((e) => e.kind)).toEqual(["exitStep", "completeBranch"]);

    const reject = compiled.workflow.transitions.find((t) => t.key === "head_review.reject")!;
    expect(reject.to).toBe("reviews.head.$rejected");
    expect(reject.effects.map((e) => e.kind)).toEqual(["exitStep", "rejectBranch"]);
  });

  it("compiles a dynamic group into a single `$person` branch", () => {
    const compiled = compile(withParallel("dynamic"));
    const compound = compiled.workflow.states.find((s) => s.key === "circulation")!;
    expect(compound.compound!.dynamic).toBe(true);
    expect(compound.compound!.branches.map((b) => b.key)).toEqual(["$person"]);
    const approve = compiled.workflow.transitions.find((t) => t.key === "member_review.approve")!;
    expect(approve.branch).toBe("$person");
  });

  it("gives every leaf a task template and turns attachments into deliverable slots", () => {
    const def = minimalDefinition();
    steps(def)[0]!.attachments = [
      { slotKey: "evidence", label: "Evidence", required: true },
      { slotKey: "extra", label: "Anything else" },
    ];
    steps(def)[0]!.workItem = { createTask: true, priority: "high" };
    const compiled = compile(def);

    expect(Object.keys(compiled.taskTemplates)).toEqual(["request", "approval"]);
    expect(compiled.taskTemplates.request).toMatchObject({
      createTask: true,
      kind: "feature_step",
      priority: "high",
      contextRef: "feature_record",
      expectedDeliverables: [
        { key: "evidence", label: "Evidence", required: true },
        { key: "extra", label: "Anything else", required: false },
      ],
    });
  });

  it("emits task templates with createTask false when the record is the task", () => {
    const def = minimalDefinition();
    def.record.backing = { kind: "task", taskKind: "general" };
    const compiled = compile(def);
    expect(Object.values(compiled.taskTemplates).every((t) => !t.createTask)).toBe(true);
  });

  it("compiles the record header and the inline step questions into forms", () => {
    const def = minimalDefinition();
    steps(def)[1]!.form = {
      sectionTitle: "Decision",
      questions: [{ key: "note", type: "long_text", label: "Note" }],
    };
    const compiled = compile(def);
    expect(compiled.forms.record).toMatchObject({
      key: "leave_request.record",
      kind: "generic",
      fields: [{ key: "reason" }],
    });
    expect(compiled.forms.approval).toMatchObject({
      key: "leave_request.approval",
      kind: "feature_step",
      title: "Decision",
    });
  });

  it("describes a time-based automatic action and subscribes an event-based one", () => {
    const def = minimalDefinition();
    steps(def)[1]!.deadline = { rule: "relative", offsetDays: 5, from: "step_entered" };
    steps(def)[1]!.actions.push({
      key: "expire",
      label: "Expire",
      kind: "auto",
      to: "rejected",
      actors: [{ type: "system" }],
      auto: { when: "deadline" },
    });
    steps(def)[0]!.actions.push({
      key: "on_term_start",
      label: "Term starts",
      kind: "auto",
      to: "approval",
      actors: [{ type: "system" }],
      auto: { when: "event", eventName: "calendar.period.changed", match: { periodKind: "teaching" } },
    });

    const compiled = compile(def);
    expect(compiled.autoTriggers.approval).toEqual([
      { stepKey: "approval", actionKey: "expire", transitionKey: "approval.expire", when: "deadline" },
    ]);
    expect(compiled.eventSubscriptions).toEqual([
      {
        handlerKey: "feature.autoOnEvent:leave_request:request:on_term_start",
        eventName: "calendar.period.changed",
        match: { periodKind: "teaching" },
        stepKey: "request",
        actionKey: "on_term_start",
      },
    ]);
    const expire = compiled.workflow.transitions.find((t) => t.key === "approval.expire")!;
    expect(expire.system).toBe(true);
  });

  it("subscribes reminders only where a step has both a deadline and a schedule", () => {
    const def = minimalDefinition();
    steps(def)[1]!.deadline = { rule: "relative", offsetDays: 3, from: "step_entered" };
    steps(def)[1]!.reminders = { scheduleKey: "default_7_3_1_0_overdue", audience: "both" };
    const compiled = compile(def);
    expect(compiled.reminderTemplates).toEqual({
      approval: {
        stepKey: "approval",
        scheduleKey: "default_7_3_1_0_overdue",
        audience: "both",
        deadline: { rule: "relative", offsetDays: 3, from: "step_entered" },
      },
    });
  });

  it("emits the permission keys, the role rows and the grants the actor rules lean on", () => {
    const def = minimalDefinition();
    def.parentSubject = { subjectType: "committee" };
    steps(def)[1]!.assignee = { type: "relationship", rel: "parent_chair" };
    const compiled = compile(def);

    expect(compiled.permissionKeys).toEqual([
      "feature.leave_request.act.approve",
      "feature.leave_request.act.reject",
      "feature.leave_request.act.submit",
      "feature.leave_request.create",
      "feature.leave_request.manage",
      "feature.leave_request.view",
    ]);
    expect(compiled.rolePermissions).toContainEqual({
      roleKey: "instructor",
      permissionKey: "feature.leave_request.view",
      level: "own",
    });
    expect(compiled.grantRequirements).toContainEqual({
      stepKey: "approval",
      actionKey: undefined,
      roleKey: "committee_chair",
      scopeType: "committee",
      derivedFrom: "parent_chair",
    });
  });

  it("uses a preset's permission prefix for every action", () => {
    const def = minimalDefinition();
    def.presets = {
      urgent: { label: "Urgent", permissionPrefix: "leave" },
      planned: { label: "Planned", permissionPrefix: "leave" },
    };
    const compiled = compile(def);
    expect(compiled.permissionKeys).toContain("leave.submit");
    expect(
      compiled.workflow.transitions.find((t) => t.key === "request.submit")!.requiredPermission,
    ).toBe("leave.submit");
  });

  it("sends a revision back to the earlier step it names", () => {
    const def = minimalDefinition();
    steps(def)[1]!.actions.push({
      key: "revise",
      label: "Ask for changes",
      kind: "request_revision",
      to: "request",
      actors: [{ type: "assignee" }],
      requiredComment: true,
    });
    const compiled = compile(def);
    const revise = compiled.workflow.transitions.find((t) => t.key === "approval.revise")!;
    expect(revise).toMatchObject({ from: "approval", to: "request", requiredComment: true });
    expect(revise.effects.map((e) => e.kind)).toEqual(["exitStep", "enterStep"]);
  });

  it("compiles the same definition to the same artefacts", () => {
    expect(compile(minimalDefinition())).toEqual(compile(minimalDefinition()));
  });
});
