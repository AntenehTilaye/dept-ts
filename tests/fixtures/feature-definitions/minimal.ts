import type { FeatureDefinitionInput } from "@/platform/feature/schema";

// The smallest definition that parses: two sequential steps and one terminal. Tests clone it and
// change the one thing they are about, so a failure names that thing rather than the boilerplate.
export function minimalDefinition(): FeatureDefinitionInput {
  return {
    schemaVersion: 1,
    key: "leave_request",
    name: "Leave request",
    labels: { singular: "Leave request", plural: "Leave requests" },
    navigation: { group: "operations", order: 10, icon: "calendar-days", visibleRoles: ["instructor"] },
    scope: { level: "department" },
    record: {
      numberPrefix: "LR",
      titleTemplate: "{{reason}}",
      fields: [{ key: "reason", type: "short_text", label: "Reason" }],
      canCreate: [{ type: "role", roles: ["instructor"] }],
    },
    steps: [
      {
        kind: "step",
        key: "request",
        label: "Request",
        assignee: { type: "creator" },
        actions: [
          {
            key: "submit",
            label: "Submit",
            kind: "submit",
            to: "$next",
            actors: [{ type: "creator" }],
          },
        ],
      },
      {
        kind: "step",
        key: "approval",
        label: "Approval",
        stepType: "review",
        assignee: { type: "role", roles: ["department_head"] },
        actions: [
          {
            key: "approve",
            label: "Approve",
            kind: "approve",
            to: "approved",
            actors: [{ type: "assignee" }],
          },
          {
            key: "reject",
            label: "Reject",
            kind: "reject",
            to: "rejected",
            actors: [{ type: "assignee" }],
            requiredComment: true,
          },
        ],
      },
    ],
    terminalStates: [
      { key: "approved", label: "Approved", category: "success" },
      { key: "rejected", label: "Rejected", category: "rejected" },
    ],
    listViews: [
      {
        key: "all",
        label: "All requests",
        columns: [
          { field: "number", label: "Number" },
          { field: "state", label: "State" },
        ],
      },
    ],
    permissions: { defaults: { instructor: "own", department_head: "manage" } },
  };
}
