import type { FeatureDefinitionInput } from "../../../src/platform/feature/schema";

// A case is a task that stays open until somebody resolves it: a question raised in a thread, a
// complaint, anything that needs a trail rather than a deliverable. It is task-backed with the
// Case extension, nudges its owner at an interval instead of a deadline, and closes itself once
// it has been resolved for `case.autoCloseDays`.

export const caseFeature: FeatureDefinitionInput = {
  schemaVersion: 1,
  key: "case",
  name: "Cases",
  description: "An issue that is followed up until it is resolved.",
  labels: { singular: "Case", plural: "Cases" },
  navigation: {
    group: "operations",
    order: 30,
    icon: "life-buoy",
    visibleRoles: ["department_head", "deputy_head", "instructor", "committee_member"],
  },
  scope: { level: "department" },
  parentSubject: {
    subjectType: "thread",
    relation: "raised_from",
    required: false,
    listUnderParent: true,
    createFromParent: true,
    allowedTypes: ["thread", "committee", "course_offering", "person", "feature_record"],
  },
  record: {
    numberPrefix: "C",
    titleTemplate: "{{summary}}",
    fields: [
      { key: "summary", type: "short_text", label: "Summary", constraints: { required: true } },
      { key: "details", type: "long_text", label: "What happened", constraints: { required: true } },
      {
        key: "category",
        type: "single_choice",
        label: "Category",
        options: [
          { value: "academic", label: "Academic" },
          { value: "administrative", label: "Administrative" },
          { value: "facility", label: "Facility" },
          { value: "other", label: "Other" },
        ],
        constraints: { required: true },
      },
      { key: "kind", type: "short_text", label: "Kind", readOnly: true },
    ],
    canCreate: [
      { type: "role", roles: ["department_head", "deputy_head", "instructor", "committee_member", "student_rep"] },
    ],
    ownerRule: { type: "creator" },
    backing: { kind: "task", taskKind: "case", extension: "case" },
  },
  presets: {
    general: { label: "Case", fieldDefaults: { kind: "case" } },
  },
  steps: [
    {
      kind: "step",
      key: "raised",
      label: "Raised",
      stepType: "form",
      assignee: { type: "creator" },
      actions: [
        {
          key: "take",
          label: "Take it on",
          kind: "custom",
          to: "$next",
          actors: [
            { type: "role", roles: ["department_head", "deputy_head"] },
            { type: "permission", key: "task.manage" },
          ],
        },
        {
          key: "close",
          label: "Close without action",
          kind: "cancel",
          to: "closed",
          actors: [{ type: "creator" }, { type: "role", roles: ["department_head"] }],
          requiredComment: true,
        },
      ],
    },
    {
      kind: "step",
      key: "in_progress",
      label: "Being handled",
      assignee: { type: "role", roles: ["department_head"] },
      adapter: { onEnter: "case.subscribeIntervalNudge", onExit: "case.cancelNudge" },
      actions: [
        {
          key: "resolve",
          label: "Resolve",
          kind: "complete",
          to: "$next",
          actors: [{ type: "assignee" }, { type: "permission", key: "task.manage" }],
          requiredComment: true,
          effects: ["case.setResolvedAt"],
        },
        {
          key: "close",
          label: "Close",
          kind: "cancel",
          to: "closed",
          actors: [{ type: "assignee" }, { type: "role", roles: ["department_head"] }],
          requiredComment: true,
        },
      ],
    },
    {
      kind: "step",
      key: "resolved",
      label: "Resolved",
      stepType: "wait",
      assignee: { type: "creator" },
      notifications: {
        onEnter: [{ templateKey: "task_completed", to: "creator", category: "workflow" }],
      },
      actions: [
        {
          key: "confirm",
          label: "Confirm",
          kind: "complete",
          to: "closed",
          actors: [{ type: "creator" }, { type: "role", roles: ["department_head"] }],
        },
        {
          key: "reopen",
          label: "Reopen",
          kind: "reopen",
          to: "in_progress",
          actors: [{ type: "creator" }, { type: "role", roles: ["department_head"] }],
          requiredComment: true,
        },
        {
          // nobody complained for `case.autoCloseDays`, so the case closes itself
          key: "auto_close",
          label: "Close automatically",
          kind: "auto",
          to: "closed",
          actors: [{ type: "system" }],
          auto: { when: "after_days", settingKey: "case.autoCloseDays" },
          effects: ["case.autoClose"],
        },
      ],
    },
  ],
  terminalStates: [{ key: "closed", label: "Closed", category: "success" }],
  listViews: [
    {
      key: "all",
      label: "All cases",
      columns: [
        { field: "number", label: "Number" },
        { field: "title", label: "Case" },
        { field: "state", label: "State" },
        { field: "owner", label: "Raised by" },
        { field: "createdAt", label: "Raised" },
      ],
      filters: [
        { field: "state", type: "state" },
        { field: "mine", type: "mine" },
      ],
    },
    {
      key: "open",
      label: "Open",
      columns: [
        { field: "number", label: "Number" },
        { field: "title", label: "Case" },
        { field: "state", label: "State" },
      ],
      where: { states: ["raised", "in_progress", "resolved"] },
    },
  ],
  dashboardCounters: [
    {
      key: "open_cases",
      label: "Open cases",
      where: { states: ["raised", "in_progress"] },
      roles: ["department_head", "deputy_head"],
      link: "open",
    },
  ],
  permissions: {
    defaults: {
      department_head: "manage",
      deputy_head: "manage",
      instructor: "own",
      committee_member: "own",
      student_rep: "own",
    },
  },
};

export default caseFeature;
