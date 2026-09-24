import { describe, expect, it } from "vitest";
import { task } from "../../../prisma/seed/features/task";
import { compile } from "@/platform/feature/compile";
import { FeatureDefinitionSchema } from "@/platform/feature/schema";
import { WorkflowDefinitionInput } from "@/platform/workflow/schema";
import { validateDefinition } from "@/platform/workflow/validate";

// The task lifecycle of P7 was a hand-written WorkflowDefinition; P9 compiles it from the
// `task` feature and P9b retired the hand-written one. This file is that contract, kept where
// it was: whatever the builder does to the definition, a task still moves
// draft → assigned → in_progress → submitted → under_review → completed, with a revision loop
// and a cancellation from every active state.

const TASK_TERMINAL_STATES = ["completed", "cancelled"] as const;

describe("the compiled task lifecycle", () => {
  const compiled = compile(FeatureDefinitionSchema.parse(task));
  const parsed = WorkflowDefinitionInput.parse(compiled.workflow);

  it("parses against the State/Transition contract and validates clean", () => {
    expect(validateDefinition({ ...parsed, version: 1 })).toEqual([]);
    expect(parsed.subjectType).toBe("feature_record");
    expect(parsed.initialState).toBe("draft");
  });

  it("every state is reachable from draft and both terminals are reachable", () => {
    const edges = new Map<string, string[]>();
    for (const t of parsed.transitions) edges.set(t.from, [...(edges.get(t.from) ?? []), t.to]);
    const seen = new Set<string>(["draft"]);
    const queue = ["draft"];
    while (queue.length) {
      for (const to of edges.get(queue.shift()!) ?? []) {
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    expect([...seen].sort()).toEqual(parsed.states.map((s) => s.key).sort());
    for (const terminal of TASK_TERMINAL_STATES) expect(seen.has(terminal)).toBe(true);
    const terminals = parsed.states.filter((s) => s.category === "terminal").map((s) => s.key);
    expect(terminals.sort()).toEqual([...TASK_TERMINAL_STATES].sort());
  });

  it("the snapshot the provisional machine left behind", () => {
    expect(parsed.states.map((s) => `${s.key}:${s.category}`)).toEqual([
      "draft:initial",
      "assigned:waiting",
      "in_progress:active",
      "submitted:waiting",
      "under_review:active",
      "revision_required:active",
      "completed:terminal",
      "cancelled:terminal",
    ]);
    expect(parsed.transitions.map((t) => t.key).sort()).toEqual(
      [
        "draft.assign",
        "assigned.start",
        "in_progress.submit",
        "submitted.review",
        "under_review.approve",
        "under_review.request_revision",
        "revision_required.resume",
        "draft.cancel",
        "assigned.cancel",
        "in_progress.cancel",
        "submitted.cancel",
        "under_review.cancel",
        "revision_required.cancel",
      ].sort(),
    );
  });

  it("the submit transition is guarded by the deliverable rule and approve writes completedAt", () => {
    const submit = parsed.transitions.find((t) => t.key === "in_progress.submit")!;
    expect(submit.guards).toContain("task.requiredDeliverablesLinked");
    const approve = parsed.transitions.find((t) => t.key === "under_review.approve")!;
    expect(approve.effects).toContainEqual({
      kind: "invokeHandler",
      args: { handler: "task.setCompletedAt" },
    });
    // a revision and a cancellation always carry a reason
    for (const key of ["under_review.request_revision", "in_progress.cancel"]) {
      expect(parsed.transitions.find((t) => t.key === key)!.requiredComment).toBe(true);
    }
  });
});
