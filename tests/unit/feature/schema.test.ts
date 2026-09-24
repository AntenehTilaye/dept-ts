import { describe, expect, it } from "vitest";
import {
  branchesOf,
  FeatureDefinitionSchema,
  isParallel,
  scopeTypeOf,
  type ParallelGroup,
  type StepDef,
  type StepDefInput,
} from "@/platform/feature/schema";
import { minimalDefinition } from "../../fixtures/feature-definitions/minimal";

const parse = (input: unknown) => FeatureDefinitionSchema.parse(input);

describe("FeatureDefinitionSchema", () => {
  it("fills in every default an author may leave out", () => {
    const def = parse(minimalDefinition());
    expect(def.record.backing).toEqual({ kind: "feature_record" });
    expect(def.record.ownerRule).toEqual({ type: "creator" });
    expect(def.presets).toEqual({});
    expect(def.dashboardCounters).toEqual([]);
    expect(def.lockedPaths).toEqual([]);
    expect(def.navigation.showInDashboard).toBe(true);
    expect(def.navigation.showCounterInNav).toBe(false);
    expect(def.scope.scopeFrom).toBe("department");
    expect(def.listViews[0]!.defaultSort).toEqual({ field: "createdAt", dir: "desc" });
    expect(def.listViews[0]!.columns[0]!.sortable).toBe(true);

    const step = def.steps[0] as StepDef;
    expect(step.stepType).toBe("form");
    expect(step.form).toBeNull();
    expect(step.attachments).toEqual([]);
    expect(step.workItem).toEqual({ createTask: true, priority: "normal" });
    expect(step.notifications).toEqual({ onEnter: [], onExit: [] });
    expect(step.canView).toEqual([{ type: "owner" }, { type: "assignee" }]);
    expect(step.canEdit).toEqual([{ type: "assignee" }]);
    expect(step.actions[0]).toMatchObject({
      requiredComment: false,
      requiredFields: [],
      requiredAttachments: [],
      guards: [],
      effects: [],
    });
  });

  it("rejects an obsolete or misspelled key instead of dropping it", () => {
    const withHierarchy = { ...minimalDefinition(), hierarchy: { nav: {}, parent: {} } };
    expect(() => parse(withHierarchy)).toThrow();

    const input = minimalDefinition();
    const { terminalStates, ...rest } = input;
    expect(() => parse({ ...rest, terminals: terminalStates })).toThrow();
  });

  it("enforces the key format on the feature, its steps, actions and terminals", () => {
    expect(() => parse({ ...minimalDefinition(), key: "Leave Request" })).toThrow();

    const badStep = minimalDefinition();
    (badStep.steps[0] as StepDefInput).key = "1st_step";
    expect(() => parse(badStep)).toThrow();

    const badAction = minimalDefinition();
    (badAction.steps[0] as StepDefInput).actions[0]!.key = "Submit";
    expect(() => parse(badAction)).toThrow();
  });

  it("parses a nested group and a static parallel group", () => {
    const input = minimalDefinition();
    const [request, approval] = input.steps as [StepDefInput, StepDefInput];
    input.steps = [
      request,
      {
        kind: "group",
        key: "preparation",
        label: "Preparation",
        steps: [
          {
            kind: "step",
            key: "collect",
            label: "Collect evidence",
            assignee: { type: "owner" },
            actions: [
              {
                key: "done",
                label: "Done",
                kind: "complete",
                to: "$next",
                actors: [{ type: "assignee" }],
              },
            ],
          },
        ],
      },
      {
        kind: "parallel",
        key: "reviews",
        label: "Reviews",
        branches: {
          mode: "static",
          items: [
            { key: "head", label: "Head", steps: [approval] },
            {
              key: "deputy",
              label: "Deputy",
              steps: [{ ...approval, key: "deputy_approval", label: "Deputy approval" }],
            },
          ],
        },
        completion: { rule: "quorum", n: 1 },
        onComplete: "approved",
        onAnyReject: "rejected",
      },
    ];

    const def = parse(input);
    const group = def.steps[1]!;
    expect(group.kind).toBe("group");
    const parallel = def.steps[2]!;
    expect(isParallel(parallel)).toBe(true);
    expect(branchesOf(parallel as ParallelGroup).map((b) => b.key)).toEqual(["head", "deputy"]);
  });

  it("names the dynamic branch template `$person` and refuses one without a person source", () => {
    const input = minimalDefinition();
    const approval = input.steps[1] as StepDefInput;
    const dynamic = {
      kind: "parallel" as const,
      key: "circulation",
      label: "Circulation",
      branches: {
        mode: "dynamic" as const,
        perPerson: { type: "relationship" as const, rel: "participant" as const },
        branch: { key: "review", label: "Review", steps: [approval] },
      },
      completion: { rule: "all" as const },
      onComplete: "approved",
    };
    input.steps = [input.steps[0]!, dynamic];
    const def = parse(input);
    expect(branchesOf(def.steps[1] as ParallelGroup).map((b) => b.key)).toEqual(["$person"]);

    const withoutSource = structuredClone(dynamic) as Record<string, unknown>;
    (withoutSource.branches as Record<string, unknown>).perPerson = undefined;
    expect(() => parse({ ...minimalDefinition(), steps: [input.steps[0]!, withoutSource] })).toThrow();
  });

  it("accepts `$next` and `$self` as action targets and keeps them verbatim", () => {
    const input = minimalDefinition();
    const step = input.steps[1] as StepDefInput;
    step.actions.push({
      key: "extend",
      label: "Extend",
      kind: "custom",
      to: "$self",
      actors: [{ type: "assignee" }],
    });
    const def = parse(input);
    const targets = (def.steps[1] as StepDef).actions.map((a) => a.to);
    expect(targets).toContain("$self");
    expect((def.steps[0] as StepDef).actions[0]!.to).toBe("$next");
  });

  it("stores the faculty scope level as the global ScopeType", () => {
    expect(scopeTypeOf("faculty")).toBe("global");
    expect(scopeTypeOf("department")).toBe("department");
    expect(scopeTypeOf("program")).toBe("program");
    expect(scopeTypeOf("section")).toBe("section");
  });
});
