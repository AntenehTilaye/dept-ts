import type { FeatureDefinitionInput, StepDefInput } from "../../../src/platform/feature/schema";

// The `task` feature: the lifecycle every task-like thing in the faculty follows. It replaces
// the hand-written definition of P7 — the record IS the Task row, so a committee task, an
// instructor task and an administrative task are the same process with a different preset,
// and the one inbox, one my-work page and one set of reminders serve all of them.

const cancel = (): StepDefInput["actions"][number] => ({
  key: "cancel",
  label: "Cancel",
  kind: "cancel",
  to: "cancelled",
  actors: [{ type: "creator" }, { type: "permission", key: "task.manage" }],
  requiredComment: true,
});

const step = (s: StepDefInput): StepDefInput => ({ ...s, actions: [...s.actions, cancel()] });

/** One preset per task kind an administrator may create; the extensions have their own feature. */
const KIND_PRESETS = [
  ["general", "General task", "task"],
  ["committee_task", "Committee task", "committee"],
  ["department_task", "Department task", "task"],
  ["instructor_task", "Instructor task", "task"],
  ["student_activity", "Student activity", "task"],
  ["administrative", "Administrative task", "task"],
  ["action_item", "Action item", "meeting"],
  ["cqi_action", "CQI action", "task"],
  ["maintenance", "Maintenance job", "resource"],
  ["lab_activity", "Laboratory activity", "resource"],
] as const;

export const task: FeatureDefinitionInput = {
  schemaVersion: 1,
  key: "task",
  name: "Tasks",
  description: "Work assigned to a person or a group, with deliverables, deadlines and reminders.",
  labels: { singular: "Task", plural: "Tasks" },
  navigation: {
    group: "operations",
    order: 10,
    icon: "check-square",
    visibleRoles: [
      "department_head",
      "deputy_head",
      "instructor",
      "committee_member",
      "student_rep",
      "lab_staff",
    ],
    showInDashboard: true,
    showCounterInNav: true,
  },
  scope: { level: "department" },
  parentSubject: {
    subjectType: "committee",
    relation: "context",
    required: false,
    listUnderParent: true,
    createFromParent: true,
    allowedTypes: ["committee", "course_offering", "section_offering", "meeting", "resource"],
  },
  record: {
    numberPrefix: "T",
    titleTemplate: "{{title}}",
    fields: [
      { key: "title", type: "short_text", label: "Title", constraints: { required: true } },
      { key: "description", type: "long_text", label: "What has to be done" },
      { key: "assignee", type: "person_picker", label: "Assigned to", sourceBinding: "staff_in_department" },
      {
        key: "audience",
        type: "multi_choice",
        label: "Or a whole audience",
        helpText: "Everybody in the audience is assigned; the group is snapshotted when the task is created.",
        options: [
          { value: "instructor", label: "Every instructor" },
          { value: "committee_chair", label: "Every committee chair" },
          { value: "student_rep", label: "Every section representative" },
        ],
      },
      {
        key: "deliverables",
        type: "repeating_group",
        label: "Deliverables",
        helpText: "A required slot must hold a file before the task can be submitted.",
        fields: [
          { key: "key", type: "short_text", label: "Key", constraints: { required: true } },
          { key: "label", type: "short_text", label: "Label", constraints: { required: true } },
          { key: "required", type: "boolean", label: "Required" },
        ],
      },
      { key: "kind", type: "short_text", label: "Kind", readOnly: true },
      {
        key: "priority",
        type: "single_choice",
        label: "Priority",
        options: [
          { value: "low", label: "Low" },
          { value: "normal", label: "Normal" },
          { value: "high", label: "High" },
          { value: "urgent", label: "Urgent" },
        ],
      },
      { key: "due_at", type: "datetime", label: "Due" },
    ],
    canCreate: [
      { type: "role", roles: ["department_head", "deputy_head", "instructor", "committee_chair"] },
      { type: "permission", key: "task.manage" },
    ],
    ownerRule: { type: "creator" },
    backing: { kind: "task", taskKind: "general" },
  },
  presets: Object.fromEntries(
    KIND_PRESETS.map(([key, label, parentSubjectType]) => [
      key,
      {
        label,
        fieldDefaults: { kind: key },
        parentSubjectType,
        navLabel: key === "general" ? undefined : label,
      },
    ]),
  ),
  steps: [
    step({
      kind: "step",
      key: "draft",
      label: "Draft",
      stepType: "form",
      assignee: { type: "creator" },
      actions: [
        {
          key: "assign",
          label: "Assign",
          kind: "assign",
          to: "$next",
          actors: [{ type: "creator" }, { type: "permission", key: "task.manage" }],
        },
      ],
    }),
    step({
      kind: "step",
      key: "assigned",
      label: "Assigned",
      stepType: "wait",
      assignee: { type: "record_field", fieldKey: "assignee" },
      notifications: {
        onEnter: [
          {
            templateKey: "task_assignment",
            to: "assignee",
            category: "assignment",
            ackRequired: true,
            declinable: true,
          },
        ],
      },
      actions: [
        {
          key: "start",
          label: "Start",
          kind: "custom",
          to: "$next",
          actors: [{ type: "assignee" }, { type: "permission", key: "task.manage" }],
        },
      ],
    }),
    step({
      kind: "step",
      key: "in_progress",
      label: "In progress",
      assignee: { type: "record_field", fieldKey: "assignee" },
      deadline: { rule: "relative", offsetDays: 0, from: "record_field", fieldKey: "due_at" },
      reminders: { scheduleKey: "default_7_3_1_0_overdue", audience: "assignee" },
      actions: [
        {
          key: "submit",
          label: "Submit",
          kind: "submit",
          to: "$next",
          actors: [{ type: "assignee" }, { type: "permission", key: "task.manage" }],
          guards: ["task.requiredDeliverablesLinked"],
        },
      ],
    }),
    step({
      kind: "step",
      key: "submitted",
      label: "Submitted",
      stepType: "wait",
      assignee: { type: "creator" },
      notifications: {
        onEnter: [{ templateKey: "task_submitted", to: "creator", category: "workflow" }],
      },
      actions: [
        {
          key: "review",
          label: "Review",
          kind: "custom",
          to: "$next",
          actors: [{ type: "creator" }, { type: "permission", key: "task.manage" }],
        },
      ],
    }),
    step({
      kind: "step",
      key: "under_review",
      label: "Under review",
      stepType: "review",
      assignee: { type: "creator" },
      actions: [
        {
          key: "approve",
          label: "Approve",
          kind: "approve",
          to: "completed",
          actors: [{ type: "creator" }, { type: "permission", key: "task.manage" }],
          effects: ["task.setCompletedAt"],
        },
        {
          key: "request_revision",
          label: "Ask for changes",
          kind: "request_revision",
          to: "revision_required",
          actors: [{ type: "creator" }, { type: "permission", key: "task.manage" }],
          requiredComment: true,
        },
      ],
    }),
    step({
      kind: "step",
      key: "revision_required",
      label: "Revision required",
      assignee: { type: "record_field", fieldKey: "assignee" },
      notifications: {
        onEnter: [{ templateKey: "task_revision_required", to: "assignee", category: "workflow" }],
      },
      actions: [
        {
          key: "resume",
          label: "Resume",
          kind: "custom",
          to: "in_progress",
          actors: [{ type: "assignee" }, { type: "permission", key: "task.manage" }],
        },
      ],
    }),
  ],
  terminalStates: [
    {
      key: "completed",
      label: "Completed",
      category: "success",
      notifications: [{ templateKey: "task_completed", to: "assignee", category: "workflow" }],
    },
    { key: "cancelled", label: "Cancelled", category: "cancelled" },
  ],
  listViews: [
    {
      key: "all",
      label: "All tasks",
      columns: [
        { field: "number", label: "Number" },
        { field: "title", label: "Task" },
        { field: "state", label: "State" },
        { field: "assignee", label: "Assignee" },
        { field: "deadline", label: "Due" },
      ],
      filters: [
        { field: "state", type: "state" },
        { field: "mine", type: "mine" },
        { field: "overdue", type: "overdue" },
        { field: "preset", type: "preset" },
      ],
      defaultSort: { field: "createdAt", dir: "desc" },
    },
    {
      key: "open",
      label: "Open",
      columns: [
        { field: "number", label: "Number" },
        { field: "title", label: "Task" },
        { field: "state", label: "State" },
        { field: "deadline", label: "Due" },
      ],
      where: { states: ["assigned", "in_progress", "submitted", "under_review", "revision_required"] },
    },
  ],
  dashboardCounters: [
    {
      key: "mine_open",
      label: "My open tasks",
      where: { assignedToMe: true },
      roles: ["instructor", "committee_member", "lab_staff", "student_rep", "deputy_head", "department_head"],
      link: "open",
    },
    {
      key: "overdue",
      label: "Overdue",
      where: { overdue: true },
      roles: ["department_head", "deputy_head"],
      link: "open",
      tone: "danger",
    },
  ],
  permissions: {
    defaults: {
      department_head: "manage",
      deputy_head: "manage",
      committee_chair: "manage",
      instructor: "assigned",
      committee_member: "assigned",
      lab_staff: "assigned",
      student_rep: "assigned",
      student: "view",
    },
  },
};

export default task;
