import type { WorkflowDefinitionInput } from "../schema";

// The ONE hand-written WorkflowDefinition of the plan (design part 06, P7): the task
// lifecycle, so the work-item service has a machine before the feature builder exists.
//
// P9 compiles `feature:task` from prisma/seed/features/task.ts, proves the compiled states
// and transitions equal this file (tests/unit/workflow/definitions-task.test.ts holds the
// snapshot both are compared against), backfills a FeatureRecord per Task and retires this
// key. Until then it is registered by prisma/seed/workflows/index.ts with isSystem: true and
// listed in PROVISIONAL_DEFINITION_KEYS.
//
// States: draft → assigned → in_progress → submitted → under_review → completed,
// with revision_required looping back to in_progress and cancelled reachable from every
// active state. `completedAt` is written only by the setField effect of the approve
// transition; overdue is computed, never stored.

export const TASK_DEFINITION_KEY = "task";

const notifyAssignees = (
  templateKey: string,
  category: string,
  extra: Record<string, unknown> = {},
) => ({
  kind: "notify" as const,
  args: {
    templateKey,
    category,
    recipientRule: "task_assignees",
    actionUrlRule: "subject",
    ...extra,
  },
});

export const taskDefinition: WorkflowDefinitionInput = {
  key: TASK_DEFINITION_KEY,
  version: 1,
  subjectType: "task",
  initialState: "draft",
  isSystem: true,
  departmentId: null,
  featureVersionId: null,
  lockedPaths: [],
  states: [
    { key: "draft", label: "Draft", category: "initial" },
    { key: "assigned", label: "Assigned", category: "active" },
    { key: "in_progress", label: "In progress", category: "active" },
    { key: "submitted", label: "Submitted", category: "waiting" },
    { key: "under_review", label: "Under review", category: "active" },
    { key: "revision_required", label: "Revision required", category: "active" },
    { key: "completed", label: "Completed", category: "terminal", terminalCategory: "success" },
    { key: "cancelled", label: "Cancelled", category: "terminal", terminalCategory: "cancelled" },
  ],
  transitions: [
    {
      key: "draft.assign",
      from: "draft",
      to: "assigned",
      action: "assign",
      actorRules: [{ type: "creator" }, { type: "permission", key: "task.manage" }],
      requiredComment: false,
      requiredFields: [],
      requiredAttachments: [],
      guards: [],
      system: false,
      effects: [
        notifyAssignees("task_assignment", "assignment", {
          ackRequired: true,
          declinable: true,
          dedupe: "assignment",
        }),
        { kind: "emit", args: { name: "task.assigned" } },
      ],
    },
    {
      // applied by the notification.acknowledged subscriber and by the assignee
      key: "assigned.start",
      from: "assigned",
      to: "in_progress",
      action: "start",
      actorRules: [{ type: "assignee" }, { type: "permission", key: "task.manage" }],
      requiredComment: false,
      requiredFields: [],
      requiredAttachments: [],
      guards: [],
      system: false,
      effects: [{ kind: "emit", args: { name: "task.started" } }],
    },
    {
      key: "in_progress.submit",
      from: "in_progress",
      to: "submitted",
      action: "submit",
      actorRules: [{ type: "assignee" }, { type: "permission", key: "task.manage" }],
      requiredComment: false,
      requiredFields: [],
      requiredAttachments: [],
      guards: ["task.requiredDeliverablesLinked"],
      system: false,
      effects: [
        {
          kind: "notify",
          args: {
            templateKey: "task_submitted",
            category: "workflow",
            recipientRule: "task_creator",
            actionUrlRule: "subject",
          },
        },
        { kind: "emit", args: { name: "task.submitted" } },
      ],
    },
    {
      key: "submitted.review",
      from: "submitted",
      to: "under_review",
      action: "review",
      actorRules: [{ type: "creator" }, { type: "permission", key: "task.manage" }],
      requiredComment: false,
      requiredFields: [],
      requiredAttachments: [],
      guards: [],
      system: false,
      effects: [],
    },
    {
      key: "under_review.approve",
      from: "under_review",
      to: "completed",
      action: "approve",
      actorRules: [{ type: "creator" }, { type: "permission", key: "task.manage" }],
      requiredComment: false,
      requiredFields: [],
      requiredAttachments: [],
      guards: [],
      system: false,
      effects: [
        { kind: "setField", args: { field: "completedAt", value: "$now" } },
        notifyAssignees("task_completed", "workflow"),
        { kind: "cancelReminders", args: {} },
        { kind: "emit", args: { name: "task.completed" } },
      ],
    },
    {
      key: "under_review.request_revision",
      from: "under_review",
      to: "revision_required",
      action: "request_revision",
      actorRules: [{ type: "creator" }, { type: "permission", key: "task.manage" }],
      requiredComment: true,
      requiredFields: [],
      requiredAttachments: [],
      guards: [],
      system: false,
      effects: [
        notifyAssignees("task_revision_required", "workflow"),
        { kind: "emit", args: { name: "task.revision_required" } },
      ],
    },
    {
      key: "revision_required.resume",
      from: "revision_required",
      to: "in_progress",
      action: "resume",
      actorRules: [{ type: "assignee" }, { type: "permission", key: "task.manage" }],
      requiredComment: false,
      requiredFields: [],
      requiredAttachments: [],
      guards: [],
      system: false,
      effects: [],
    },
    ...(["draft", "assigned", "in_progress", "submitted", "under_review", "revision_required"].map(
      (from) => ({
        key: `${from}.cancel`,
        from,
        to: "cancelled",
        action: "cancel",
        actorRules: [
          { type: "creator" as const },
          { type: "permission" as const, key: "task.manage" },
        ],
        requiredComment: true,
        requiredFields: [],
        requiredAttachments: [],
        guards: [],
        system: false,
        effects: [
          { kind: "cancelReminders" as const, args: {} },
          { kind: "cancelScheduled" as const, args: {} },
          { kind: "emit" as const, args: { name: "task.cancelled" } },
        ],
      }),
    ) as WorkflowDefinitionInput["transitions"]),
  ],
};

/** Terminal states of the task machine (used by queries: "open" = not in one of these). */
export const TASK_TERMINAL_STATES = ["completed", "cancelled"] as const;
