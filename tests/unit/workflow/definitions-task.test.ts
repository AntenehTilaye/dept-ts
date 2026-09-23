import { describe, expect, it } from "vitest";
import { taskDefinition, TASK_TERMINAL_STATES } from "@/platform/workflow/definitions/task";
import { WorkflowDefinitionInput } from "@/platform/workflow/schema";
import { validateDefinition } from "@/platform/workflow/validate";

// The provisional task machine is the contract P9's compiled `feature:task` must reproduce:
// this snapshot is what the compiler is compared against.

describe("provisional task definition", () => {
  const parsed = WorkflowDefinitionInput.parse(taskDefinition);

  it("parses against the State/Transition contract and validates clean", () => {
    expect(validateDefinition({ ...parsed, version: 1 })).toEqual([]);
    expect(parsed.subjectType).toBe("task");
    expect(parsed.initialState).toBe("draft");
    expect(parsed.isSystem).toBe(true);
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

  it("the snapshot P9 must reproduce", () => {
    expect(parsed.states.map((s) => `${s.key}:${s.category}`)).toEqual([
      "draft:initial",
      "assigned:active",
      "in_progress:active",
      "submitted:waiting",
      "under_review:active",
      "revision_required:active",
      "completed:terminal",
      "cancelled:terminal",
    ]);
    expect(parsed.transitions.map((t) => t.key)).toEqual([
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
    ]);
  });

  it("the submit transition is guarded by the deliverable rule and approve writes completedAt", () => {
    const submit = parsed.transitions.find((t) => t.key === "in_progress.submit")!;
    expect(submit.guards).toEqual(["task.requiredDeliverablesLinked"]);
    const approve = parsed.transitions.find((t) => t.key === "under_review.approve")!;
    expect(approve.effects[0]).toEqual({
      kind: "setField",
      args: { field: "completedAt", value: "$now" },
    });
    // a revision and a cancellation always carry a reason
    for (const key of ["under_review.request_revision", "in_progress.cancel"]) {
      expect(parsed.transitions.find((t) => t.key === key)!.requiredComment).toBe(true);
    }
  });
});
