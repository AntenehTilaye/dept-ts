import { describe, expect, it } from "vitest";
import { simulate, type SimulationScript } from "@/platform/feature/simulate";
import type { FeatureDefinitionInput, StepDefInput } from "@/platform/feature/schema";
import { minimalDefinition } from "../../fixtures/feature-definitions/minimal";

const steps = (def: FeatureDefinitionInput) => def.steps as StepDefInput[];

const instructor: SimulationScript["actor"] = {
  personId: "sim-actor",
  roles: ["instructor"],
  grantRoleKeys: [],
  relationships: ["owner", "creator"],
};
const head: SimulationScript["actor"] = {
  personId: "sim-head",
  roles: ["department_head"],
  grantRoleKeys: [],
  relationships: ["assignee"],
};
// one actor plays the whole path in a simulation, so a multi-step script needs every hat
const everyone: SimulationScript["actor"] = {
  personId: "sim-actor",
  roles: ["instructor", "department_head"],
  grantRoleKeys: [],
  relationships: ["owner", "creator", "assignee"],
};

function parallelDefinition(): FeatureDefinitionInput {
  const def = minimalDefinition();
  const [request, approval] = steps(def);
  const reviewer = (key: string, label: string): StepDefInput => ({
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
    {
      kind: "parallel",
      key: "reviews",
      label: "Reviews",
      branches: {
        mode: "static",
        items: [
          { key: "head", label: "Head", steps: [reviewer("head_review", "Head review")] },
          { key: "deputy", label: "Deputy", steps: [reviewer("deputy_review", "Deputy review")] },
        ],
      },
      completion: { rule: "quorum", n: 1 },
      onComplete: "approved",
      onAnyReject: "rejected",
    },
  ];
  return def;
}

describe("simulate", () => {
  it("walks the happy path and reports the steps, assignees and tasks it would create", () => {
    const def = minimalDefinition();
    steps(def)[1]!.notifications = { onEnter: [{ templateKey: "assignment", to: "assignee" }] };
    const trace = simulate(def, {
      actor: instructor,
      record: { reason: "Conference" },
      path: [{ stepKey: "request", actionKey: "submit" }],
    });

    expect(trace.states).toEqual(["request", "approval"]);
    expect(trace.steps.map((s) => s.stepKey)).toEqual(["request", "approval"]);
    expect(trace.steps[1]).toMatchObject({ assignee: "role:department_head" });
    expect(trace.steps[1]!.task).toMatchObject({ createTask: true, kind: "feature_step" });
    expect(trace.notifications.map((n) => n.templateKey)).toContain("assignment");
    expect(trace.guards.filter((g) => g.result === "fail")).toEqual([]);
  });

  it("reports the rejection path as a terminal state", () => {
    const trace = simulate(minimalDefinition(), {
      actor: everyone,
      record: { reason: "Conference" },
      path: [
        { stepKey: "request", actionKey: "submit" },
        { stepKey: "approval", actionKey: "reject", comment: "Not this term" },
      ],
    });
    expect(trace.states.at(-1)).toBe("rejected");
  });

  it("fails the actor guard when the actor matches no rule", () => {
    const stranger = { personId: "x", roles: ["student" as const], grantRoleKeys: [], relationships: [] };
    const trace = simulate(minimalDefinition(), {
      actor: stranger,
      path: [{ stepKey: "request", actionKey: "submit" }],
    });
    expect(trace.guards.some((g) => g.key === "feature.actorAllowed" && g.result === "fail")).toBe(true);
    expect(trace.states).toEqual(["request"]);
    expect(trace.issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("refuses an action whose required answers and attachments are missing", () => {
    const def = minimalDefinition();
    steps(def)[0]!.attachments = [{ slotKey: "evidence", label: "Evidence", required: true }];
    steps(def)[0]!.actions[0]!.requiredAttachments = ["evidence"];
    steps(def)[0]!.actions[0]!.requiredFields = ["reason"];

    // the machine refuses the move before a guard runs: the required input is not there yet
    const trace = simulate(def, { actor: instructor, path: [{ stepKey: "request", actionKey: "submit" }] });
    expect(trace.states).toEqual(["request"]);
    expect(trace.issues.some((i) => i.message.includes("attachments"))).toBe(true);

    const complete = simulate(def, {
      actor: instructor,
      record: { reason: "Conference" },
      path: [{ stepKey: "request", actionKey: "submit", attachments: ["evidence"] }],
    });
    expect(complete.states).toEqual(["request", "approval"]);
  });

  it("joins a quorum of one on the first approval and skips the sibling branch", () => {
    const trace = simulate(parallelDefinition(), {
      actor: everyone,
      record: { reason: "Conference" },
      path: [
        { stepKey: "request", actionKey: "submit" },
        { stepKey: "head_review", branchKey: "head", actionKey: "approve" },
      ],
    });

    expect(trace.states).toEqual(["request", "reviews", "approved"]);
    expect(trace.steps.map((s) => s.stepKey)).toEqual([
      "request",
      "head_review",
      "deputy_review",
    ]);
    const last = trace.branchStates.at(-1) as Record<string, { status: string }>;
    expect(last.head!.status).toBe("done");
    expect(last.deputy!.status).toBe("skipped");
  });

  it("sends the whole record to the rejection target when one branch rejects", () => {
    const trace = simulate(parallelDefinition(), {
      actor: everyone,
      record: { reason: "Conference" },
      path: [
        { stepKey: "request", actionKey: "submit" },
        { stepKey: "deputy_review", branchKey: "deputy", actionKey: "reject", comment: "No" },
      ],
    });
    expect(trace.states.at(-1)).toBe("rejected");
  });

  it("reports acting on a step the record is not in as an issue", () => {
    const trace = simulate(minimalDefinition(), {
      actor: head,
      path: [{ stepKey: "approval", actionKey: "approve" }],
    });
    expect(trace.issues.some((i) => i.message.includes("the record is in"))).toBe(true);
  });

  it("reports an adapter guard as would_run instead of guessing", () => {
    const def = minimalDefinition();
    steps(def)[0]!.actions[0]!.guards = ["task.requiredDeliverablesLinked"];
    const trace = simulate(def, {
      actor: instructor,
      record: { reason: "Conference" },
      path: [{ stepKey: "request", actionKey: "submit" }],
    });
    expect(trace.guards).toContainEqual({ key: "task.requiredDeliverablesLinked", result: "would_run" });
    expect(trace.states).toEqual(["request", "approval"]);
  });

  it("lists the grants the actor would still need", () => {
    const def = minimalDefinition();
    def.parentSubject = { subjectType: "committee" };
    steps(def)[1]!.assignee = { type: "relationship", rel: "parent_chair" };
    const trace = simulate(def, {
      actor: instructor,
      record: { reason: "Conference" },
      path: [{ stepKey: "request", actionKey: "submit" }],
    });
    expect(trace.grantsNeeded).toEqual(["committee_chair@committee"]);
  });

  it("materialises the reminder offsets around the resolved deadline", () => {
    const def = minimalDefinition();
    steps(def)[1]!.deadline = { rule: "relative", offsetDays: 5, from: "step_entered" };
    steps(def)[1]!.reminders = { scheduleKey: "default_7_3_1_0_overdue" };
    const trace = simulate(def, {
      actor: instructor,
      record: { reason: "Conference" },
      now: "2026-01-15T09:00:00.000Z",
      schedules: { default_7_3_1_0_overdue: [-3, 0, 1] },
      path: [{ stepKey: "request", actionKey: "submit" }],
    });
    const approval = trace.steps.find((s) => s.stepKey === "approval")!;
    expect(approval.deadline).toBe("2026-01-20T09:00:00.000Z");
    expect(approval.reminders).toEqual([
      "2026-01-17T09:00:00.000Z",
      "2026-01-20T09:00:00.000Z",
      "2026-01-21T09:00:00.000Z",
    ]);
  });
});
