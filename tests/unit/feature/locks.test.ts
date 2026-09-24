import { describe, expect, it } from "vitest";
import {
  allLocks,
  assertLockedPathsUnchanged,
  canonical,
  deriveImplicitLocks,
  expandPointer,
  lockedHash,
  lockedPathsChanged,
  LockViolation,
  resolvePointer,
} from "@/platform/feature/locks";
import { FeatureDefinitionSchema, type FeatureDefinitionInput, type StepDefInput } from "@/platform/feature/schema";
import { minimalDefinition } from "../../fixtures/feature-definitions/minimal";

function codeBacked(): FeatureDefinitionInput {
  const input = minimalDefinition();
  const steps = input.steps as StepDefInput[];
  steps[0]!.adapter = { onEnter: "task.backing" };
  steps[0]!.surface = "slot_picker";
  steps[0]!.actions[0]!.guards = ["task.requiredDeliverablesLinked"];
  steps[0]!.actions[0]!.effects = ["task.setCompletedAt"];
  steps[1]!.actions.push({
    key: "expire",
    label: "Expire",
    kind: "auto",
    to: "rejected",
    actors: [{ type: "system" }],
    auto: { when: "deadline" },
  });
  input.record.backing = { kind: "task", taskKind: "general" };
  input.record.fields = [
    { key: "reason", type: "short_text", label: "Reason" },
    { key: "score", type: "computed", label: "Score", computedBy: "case.score" },
    { key: "member", type: "person_picker", label: "Member", sourceBinding: "staff_in_department" },
  ];
  input.presets = {
    urgent: {
      label: "Urgent",
      fieldDefaults: { reason: "urgent" },
      adapters: { "request.submit.guard": "task.requiredDeliverablesLinked" },
      permissionPrefix: "urgent",
    },
  };
  input.terminalStates[0]!.effects = ["task.setCompletedAt"];
  return input;
}

const parse = (input: FeatureDefinitionInput) => FeatureDefinitionSchema.parse(input);

describe("locks", () => {
  it("derives a lock for every pointer that names code", () => {
    const def = parse(codeBacked());
    const locks = deriveImplicitLocks(def);
    expect(locks).toContain("/key");
    expect(locks).toContain("/record/backing");
    expect(locks).toContain("/record/fields/1/computedBy");
    expect(locks).toContain("/record/fields/2/sourceBinding");
    expect(locks).toContain("/steps/0/adapter");
    expect(locks).toContain("/steps/0/surface");
    expect(locks).toContain("/steps/0/actions/0/guards");
    expect(locks).toContain("/steps/0/actions/0/effects");
    expect(locks).toContain("/steps/1/actions/2/auto");
    expect(locks).toContain("/presets/urgent/adapters");
    expect(locks).toContain("/presets/urgent/fieldDefaults");
    expect(locks).toContain("/presets/urgent/permissionPrefix");
    expect(locks).toContain("/terminalStates/0/effects");
  });

  it("locks nothing in a definition an administrator authored themselves", () => {
    expect(deriveImplicitLocks(parse(codeBacked()), false)).toEqual([]);
  });

  it("adds the pointers a seed locks explicitly, expanding wildcards", () => {
    const input = codeBacked();
    input.lockedPaths = ["/record/fields/0", "/listViews/*/key"];
    const locks = allLocks(parse(input));
    expect(locks).toContain("/record/fields/0");
    expect(locks).toContain("/listViews/0/key");
  });

  it("sees a changed locked pointer and ignores everything else", () => {
    const previous = parse(codeBacked());
    const edited = codeBacked();
    (edited.steps as StepDefInput[])[0]!.label = "Request leave";
    edited.name = "Leave";
    const unlockedChange = parse(edited);
    expect(lockedPathsChanged(previous, unlockedChange, allLocks(previous))).toEqual([]);
    expect(() =>
      assertLockedPathsUnchanged(previous, unlockedChange, allLocks(previous)),
    ).not.toThrow();

    const repointed = codeBacked();
    (repointed.steps as StepDefInput[])[0]!.actions[0]!.guards = ["case.autoClose"];
    const diffs = lockedPathsChanged(previous, parse(repointed), allLocks(previous));
    expect(diffs.map((d) => d.path)).toEqual(["/steps/0/actions/0/guards"]);
    expect(() => assertLockedPathsUnchanged(previous, parse(repointed), allLocks(previous))).toThrow(
      LockViolation,
    );
  });

  it("hashes the locked subtree, not the order the document was written in", () => {
    const def = parse(codeBacked());
    const reordered = Object.fromEntries(Object.entries(def).reverse()) as typeof def;
    expect(lockedHash(reordered)).toBe(lockedHash(def));

    const relabelled = codeBacked();
    relabelled.labels = { singular: "Leave", plural: "Leaves" };
    expect(lockedHash(parse(relabelled))).toBe(lockedHash(def));

    const rebacked = codeBacked();
    rebacked.record.backing = { kind: "feature_record" };
    expect(lockedHash(parse(rebacked))).not.toBe(lockedHash(def));
  });

  it("resolves and expands RFC 6901 pointers", () => {
    const def = parse(codeBacked());
    expect(resolvePointer(def, "/record/numberPrefix")).toBe("LR");
    expect(resolvePointer(def, "/steps/0/key")).toBe("request");
    expect(resolvePointer(def, "/steps/9/key")).toBeUndefined();
    expect(expandPointer(def, "/terminalStates/*/key")).toEqual([
      "/terminalStates/0/key",
      "/terminalStates/1/key",
    ]);
    expect(canonical({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
  });
});
