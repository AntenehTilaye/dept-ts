import { describe, expect, it } from "vitest";
import { FeatureDefinitionSchema, type FeatureDefinitionInput, type StepDefInput } from "@/platform/feature/schema";
import {
  errorsOnly,
  grantRequirements,
  validateDefinition,
  type ValidationContext,
} from "@/platform/feature/validate";
import { minimalDefinition } from "../../fixtures/feature-definitions/minimal";

// One case per rule code of design part 03 §4. Each starts from the same valid definition and
// breaks exactly one thing, so the assertion reads as the rule it is about.

function codes(
  mutate: (def: FeatureDefinitionInput) => void,
  ctx: ValidationContext = {},
): string[] {
  const input = minimalDefinition();
  mutate(input);
  const def = FeatureDefinitionSchema.parse(input);
  return validateDefinition(def, ctx).map((i) => i.code);
}

const steps = (def: FeatureDefinitionInput) => def.steps as StepDefInput[];

describe("validateDefinition", () => {
  it("reports nothing to fix for a valid definition", () => {
    const def = FeatureDefinitionSchema.parse(minimalDefinition());
    expect(errorsOnly(validateDefinition(def))).toEqual([]);
  });

  it("KEY_FORMAT: a record field key that is not a state-safe key", () => {
    expect(
      codes((def) => {
        def.record.fields = [{ key: "a".repeat(50), type: "short_text", label: "Long" }];
        def.record.titleTemplate = "x";
      }),
    ).toContain("KEY_FORMAT");
  });

  it("KEY_UNIQUE: two steps with the same key, and a key another feature owns", () => {
    expect(
      codes((def) => {
        steps(def)[1]!.key = "request";
      }),
    ).toContain("KEY_UNIQUE");
    expect(codes(() => {}, { takenKeys: ["leave_request"] })).toContain("KEY_UNIQUE");
  });

  it("INITIAL_IS_STEP: the tree starts with a parallel group", () => {
    expect(
      codes((def) => {
        const [request, approval] = steps(def);
        def.steps = [
          {
            kind: "parallel",
            key: "reviews",
            label: "Reviews",
            branches: {
              mode: "static",
              items: [
                { key: "first", label: "First", steps: [request!] },
                { key: "second", label: "Second", steps: [{ ...request!, key: "request_b" }] },
              ],
            },
            completion: { rule: "all" },
            onComplete: "$next",
          },
          approval!,
        ];
      }),
    ).toContain("INITIAL_IS_STEP");
  });

  it("TO_RESOLVES: an action pointing at a state that does not exist", () => {
    expect(
      codes((def) => {
        steps(def)[1]!.actions[0]!.to = "archived";
      }),
    ).toContain("TO_RESOLVES");
  });

  it("NEXT_UNRESOLVED: `$next` on the last step of the tree", () => {
    expect(
      codes((def) => {
        steps(def)[1]!.actions[0]!.to = "$next";
      }),
    ).toContain("NEXT_UNRESOLVED");
  });

  it("REACHABLE: a step nothing leads to", () => {
    expect(
      codes((def) => {
        const orphan: StepDefInput = {
          kind: "step",
          key: "archive",
          label: "Archive",
          assignee: { type: "owner" },
          actions: [
            { key: "close", label: "Close", kind: "complete", to: "approved", actors: [{ type: "owner" }] },
          ],
        };
        def.steps = [...steps(def), orphan];
      }),
    ).toContain("REACHABLE");
  });

  it("TERMINAL_EXISTS: no terminal with the category success", () => {
    expect(
      codes((def) => {
        def.terminalStates = [{ key: "approved", label: "Approved", category: "cancelled" }];
        steps(def)[1]!.actions = [steps(def)[1]!.actions[0]!];
      }),
    ).toContain("TERMINAL_EXISTS");
  });

  it("DEAD_END: a step whose only action re-enters itself", () => {
    expect(
      codes((def) => {
        steps(def)[1]!.actions = [
          { key: "extend", label: "Extend", kind: "custom", to: "$self", actors: [{ type: "assignee" }] },
        ];
      }),
    ).toContain("DEAD_END");
  });

  it("ACTOR_PRESENT: the system acting outside an automatic action", () => {
    expect(
      codes((def) => {
        steps(def)[0]!.actions[0]!.actors = [{ type: "system" }];
      }),
    ).toContain("ACTOR_PRESENT");
    expect(
      codes((def) => {
        steps(def)[0]!.actions[0]!.kind = "auto";
        steps(def)[0]!.actions[0]!.actors = [{ type: "system" }];
      }),
    ).toContain("ACTOR_PRESENT");
  });

  it("ASSIGNEE_RESOLVABLE: a record_field assignee that is not a person picker", () => {
    expect(
      codes((def) => {
        steps(def)[1]!.assignee = { type: "record_field", fieldKey: "reason" };
      }),
    ).toContain("ASSIGNEE_RESOLVABLE");
    expect(
      codes((def) => {
        steps(def)[1]!.assignee = { type: "relationship", rel: "parent_chair" };
      }),
    ).toContain("ASSIGNEE_RESOLVABLE");
  });

  it("GRANT_SOURCE: a relationship whose grant the parent cannot produce", () => {
    expect(
      codes((def) => {
        def.parentSubject = { subjectType: "course_offering" };
        steps(def)[1]!.assignee = { type: "relationship", rel: "parent_chair" };
      }),
    ).toContain("GRANT_SOURCE");
  });

  it("PARALLEL_BRANCHES: a quorum larger than the number of branches", () => {
    expect(
      codes((def) => {
        const approval = steps(def)[1]!;
        def.steps = [
          steps(def)[0]!,
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
            completion: { rule: "quorum", n: 3 },
            onComplete: "approved",
            onAnyReject: "rejected",
          },
        ];
      }),
    ).toContain("PARALLEL_BRANCHES");
  });

  it("PARALLEL_EXIT: a branch action that jumps out of its branch", () => {
    const result = codes((def) => {
      const approval = steps(def)[1]!;
      def.steps = [
        steps(def)[0]!,
        {
          kind: "parallel",
          key: "reviews",
          label: "Reviews",
          branches: {
            mode: "static",
            items: [
              {
                key: "head",
                label: "Head",
                steps: [
                  {
                    ...approval,
                    actions: [
                      {
                        key: "approve",
                        label: "Approve",
                        kind: "approve",
                        to: "deputy_approval",
                        actors: [{ type: "assignee" }],
                      },
                    ],
                  },
                ],
              },
              {
                key: "deputy",
                label: "Deputy",
                steps: [{ ...approval, key: "deputy_approval", label: "Deputy approval" }],
              },
            ],
          },
          completion: { rule: "all" },
          onComplete: "approved",
        },
      ];
    });
    expect(result).toContain("PARALLEL_EXIT");
  });

  it("REVISION_LOOP: a revision that sends the record forward to a review step", () => {
    expect(
      codes((def) => {
        steps(def)[0]!.actions.push({
          key: "send_back",
          label: "Send back",
          kind: "request_revision",
          to: "approval",
          actors: [{ type: "creator" }],
        });
      }),
    ).toContain("REVISION_LOOP");
  });

  it("REQUIRED_FIELDS and REQUIRED_ATTACHMENTS: references to answers and slots that do not exist", () => {
    const result = codes((def) => {
      steps(def)[0]!.actions[0]!.requiredFields = ["nowhere"];
      steps(def)[0]!.actions[0]!.requiredAttachments = ["evidence"];
    });
    expect(result).toContain("REQUIRED_FIELDS");
    expect(result).toContain("REQUIRED_ATTACHMENTS");
  });

  it("FORM_REF: an unpublished form key and a repeating group without questions", () => {
    expect(
      codes(
        (def) => {
          steps(def)[0]!.form = { sectionTitle: "Details", formKey: "missing_form" };
        },
        { publishedForms: ["appointment_request"] },
      ),
    ).toContain("FORM_REF");
    expect(
      codes((def) => {
        steps(def)[0]!.form = {
          sectionTitle: "Details",
          questions: [{ key: "items", type: "repeating_group", label: "Items" }],
        };
      }),
    ).toContain("FORM_REF");
  });

  it("BINDING_ARGS: a parent binding without a parent, and an unpublished feature", () => {
    expect(
      codes((def) => {
        def.record.fields = [
          { key: "member", type: "person_picker", label: "Member", sourceBinding: "members_of_parent" },
        ];
        def.record.titleTemplate = "x";
      }),
    ).toContain("BINDING_ARGS");
    expect(
      codes(
        (def) => {
          def.record.fields = [
            {
              key: "case_ref",
              type: "record_picker",
              label: "Case",
              recordPicker: { featureKey: "case" },
            },
          ];
          def.record.titleTemplate = "x";
        },
        { publishedFeatures: [{ key: "task" }] },
      ),
    ).toContain("BINDING_ARGS");
  });

  it("TEMPLATE_EXISTS and SCHEDULE_EXISTS: unknown template and schedule keys", () => {
    const ctx: ValidationContext = { templateKeys: ["assignment"], scheduleKeys: ["deadline_default"] };
    expect(
      codes((def) => {
        steps(def)[1]!.notifications = {
          onEnter: [{ templateKey: "no_such_template", to: "assignee" }],
        };
      }, ctx),
    ).toContain("TEMPLATE_EXISTS");
    expect(
      codes((def) => {
        steps(def)[1]!.reminders = { scheduleKey: "no_such_schedule" };
      }, ctx),
    ).toContain("SCHEDULE_EXISTS");
  });

  it("DEADLINE_FIELD: a deadline that reads a field which holds no date", () => {
    expect(
      codes((def) => {
        steps(def)[1]!.deadline = { rule: "relative", offsetDays: 3, from: "record_field", fieldKey: "reason" };
      }),
    ).toContain("DEADLINE_FIELD");
  });

  it("ROLE_EXISTS: a role no Role row provides", () => {
    expect(
      codes(() => {}, { roleKeys: ["department_head", "instructor"] }).filter((c) => c === "ROLE_EXISTS"),
    ).toEqual([]);
    expect(codes(() => {}, { roleKeys: ["department_head"] })).toContain("ROLE_EXISTS");
  });

  it("PARENT_TYPE: an unregistered subject type and a feature that is its own parent", () => {
    expect(
      codes(
        (def) => {
          def.parentSubject = { subjectType: "committee" };
        },
        { subjectTypes: ["person", "task"] },
      ),
    ).toContain("PARENT_TYPE");
    expect(
      codes((def) => {
        def.parentSubject = { subjectType: "feature_record", featureKey: "leave_request" };
      }),
    ).toContain("PARENT_TYPE");
  });

  it("SCOPE_CONSISTENT: a scope field that is not a programme or section picker", () => {
    expect(
      codes((def) => {
        def.scope = { level: "program", scopeFrom: "record_field", fieldKey: "reason" };
      }),
    ).toContain("SCOPE_CONSISTENT");
  });

  it("ADAPTER_EXISTS: an unknown adapter and one registered for another hook", () => {
    const ctx: ValidationContext = { adapters: { "task.backing": "backing", "case.autoClose": "effect" } };
    expect(
      codes((def) => {
        steps(def)[0]!.actions[0]!.guards = ["task.missingGuard"];
      }, ctx),
    ).toContain("ADAPTER_EXISTS");
    expect(
      codes((def) => {
        steps(def)[0]!.actions[0]!.guards = ["case.autoClose"];
      }, ctx),
    ).toContain("ADAPTER_EXISTS");
  });

  it("SURFACE_EXISTS: a step renderer no module registers", () => {
    expect(
      codes(
        (def) => {
          steps(def)[1]!.surface = "assessment";
        },
        { surfaces: { leave_request: ["slot_picker"] } },
      ),
    ).toContain("SURFACE_EXISTS");
  });

  it("PRESET_CONSISTENT: a preset that overrides a step or field which does not exist", () => {
    expect(
      codes((def) => {
        def.presets = { urgent: { label: "Urgent", formKeys: { nowhere: "some_form" } } };
      }),
    ).toContain("PRESET_CONSISTENT");
    expect(
      codes((def) => {
        def.presets = {
          urgent: { label: "Urgent", permissionPrefix: "urgent" },
          normal: { label: "Normal" },
        };
      }),
    ).toContain("PRESET_CONSISTENT");
  });

  it("LIST_COLUMNS: a column, a state and a counter link that do not exist", () => {
    expect(
      codes((def) => {
        def.listViews[0]!.columns = [{ field: "nowhere", label: "Nowhere" }];
      }),
    ).toContain("LIST_COLUMNS");
    expect(
      codes((def) => {
        def.dashboardCounters = [
          {
            key: "open",
            label: "Open",
            where: { states: ["nowhere"] },
            roles: ["department_head"],
            link: "missing_view",
          },
        ];
      }),
    ).toContain("LIST_COLUMNS");
  });

  it("LOCK_VIOLATION and BACKING_LOCKED: changing what the code owns", () => {
    const previous = FeatureDefinitionSchema.parse(minimalDefinition());
    const withGuard = minimalDefinition();
    (withGuard.steps as StepDefInput[])[0]!.actions[0]!.guards = ["task.requiredDeliverablesLinked"];
    const baseline = FeatureDefinitionSchema.parse(withGuard);

    const changedGuard = codes(
      (def) => {
        (def.steps as StepDefInput[])[0]!.actions[0]!.guards = ["case.autoClose"];
      },
      { isSystem: true, previous: { json: baseline } },
    );
    expect(changedGuard).toContain("LOCK_VIOLATION");

    const changedBacking = codes(
      (def) => {
        def.record.backing = { kind: "task", taskKind: "general" };
      },
      { isSystem: true, previous: { json: previous } },
    );
    expect(changedBacking).toContain("BACKING_LOCKED");
  });

  it("warns about a review without a deadline and a silent step", () => {
    const def = FeatureDefinitionSchema.parse(minimalDefinition());
    const warnings = validateDefinition(def).filter((i) => i.severity === "warning");
    expect(warnings.map((w) => w.code)).toContain("WARN_NO_DEADLINE");

    expect(
      codes((d) => {
        (d.steps as StepDefInput[])[0]!.workItem = { createTask: false };
      }),
    ).toContain("WARN_NO_NOTIFY");
  });

  it("lists the RoleGrants a definition leans on", () => {
    const input = minimalDefinition();
    input.parentSubject = { subjectType: "committee" };
    (input.steps as StepDefInput[])[1]!.assignee = { type: "relationship", rel: "parent_chair" };
    const def = FeatureDefinitionSchema.parse(input);
    expect(grantRequirements(def)).toContainEqual({
      stepKey: "approval",
      actionKey: undefined,
      roleKey: "committee_chair",
      scopeType: "committee",
      derivedFrom: "parent_chair",
    });
  });
});
