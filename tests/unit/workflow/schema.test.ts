import { describe, expect, it } from "vitest";
import { z } from "zod";
import linear from "../../fixtures/workflows/linear.json";
import compound from "../../fixtures/workflows/compound_review.json";
import {
  WorkflowDefinitionInput,
  WorkflowStateJson,
  WorkflowTransitionJson,
} from "@/platform/workflow/schema";
import { validateDefinition } from "@/platform/workflow/validate";

function parse(raw: unknown) {
  const input = WorkflowDefinitionInput.parse(raw);
  return {
    key: input.key,
    version: 1,
    subjectType: input.subjectType,
    initialState: input.initialState,
    states: input.states,
    transitions: input.transitions,
  };
}

describe("workflow contract", () => {
  it("parses both fixtures with no structural issues", () => {
    expect(validateDefinition(parse(linear))).toEqual([]);
    expect(validateDefinition(parse(compound))).toEqual([]);
  });

  it("rejects a from array, a joinPolicy key and other foreign shapes", () => {
    const t = { ...linear.transitions[0], from: ["draft", "review"] };
    expect(WorkflowTransitionJson.safeParse(t).success).toBe(false);
    expect(
      WorkflowTransitionJson.safeParse({ ...linear.transitions[0], joinPolicy: "all" }).success,
    ).toBe(false);
    expect(WorkflowStateJson.safeParse({ ...linear.states[0], branchStateJson: {} }).success).toBe(
      false,
    );
    expect(
      z.array(WorkflowStateJson).safeParse([
        {
          ...compound.states[1],
          compound: { ...compound.states[1]!.compound, completion: { rule: "quorum", n: 0 } },
        },
      ]).success,
    ).toBe(false);
  });

  it("flags a quorum larger than the branch count, undeclared branch states and unreachable terminals", () => {
    const def = parse(compound);
    const big = structuredClone(def);
    big.states[1]!.compound!.completion = { rule: "quorum", n: 3 };
    expect(validateDefinition(big).map((i) => i.code)).toContain("quorum_too_large");

    const undeclared = structuredClone(def);
    undeclared.states[1]!.compound!.branches[0]!.doneState = "review.chair.finished";
    expect(validateDefinition(undeclared).map((i) => i.code)).toContain("undeclared_branch_state");

    const unreachable = structuredClone(parse(linear));
    unreachable.states.push({
      key: "archived",
      label: "Archived",
      category: "terminal",
      terminalCategory: "success",
    });
    expect(validateDefinition(unreachable).map((i) => i.code)).toContain("unreachable_terminal");

    const bad = structuredClone(parse(linear));
    bad.transitions[0]!.to = "nowhere";
    bad.initialState = "missing";
    const codes = validateDefinition(bad).map((i) => i.code);
    expect(codes).toContain("unknown_state");

    const dup = structuredClone(parse(linear));
    dup.transitions.push({ ...dup.transitions[0]! });
    dup.states.push({ ...dup.states[0]! });
    expect(validateDefinition(dup).map((i) => i.code)).toEqual(
      expect.arrayContaining(["duplicate_transition", "duplicate_state"]),
    );

    const noBranch = structuredClone(def);
    delete (noBranch.transitions[1] as { branch?: string }).branch;
    expect(validateDefinition(noBranch).map((i) => i.code)).toContain("branch_missing");

    const noTerminalCategory = structuredClone(parse(linear));
    delete (noTerminalCategory.states[3] as { terminalCategory?: string }).terminalCategory;
    expect(validateDefinition(noTerminalCategory).map((i) => i.code)).toContain(
      "terminal_category",
    );

    const dynamicBad = structuredClone(def);
    dynamicBad.states[1]!.compound!.dynamic = true;
    expect(validateDefinition(dynamicBad).map((i) => i.code)).toContain("dynamic_branch");

    const wrongCategory = structuredClone(def);
    wrongCategory.states[1]!.category = "active";
    expect(validateDefinition(wrongCategory).map((i) => i.code)).toContain("compound_category");
  });
});
