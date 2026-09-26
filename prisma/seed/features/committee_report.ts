import type { FeatureDefinitionInput } from "../../../src/platform/feature/schema";

// What a committee owes the department at the end of a period: what it did, which of its tasks
// it finished, what it recommends and what it cannot settle on its own. The last of those is the
// point of the process — an issue a committee raises becomes a case the department has to
// answer, rather than a paragraph nobody reads.

export const committeeReport: FeatureDefinitionInput = {
  schemaVersion: 1,
  key: "committee_report",
  name: "Committee reports",
  description: "A committee's account of one period, reviewed by the head.",
  labels: { singular: "Committee report", plural: "Committee reports" },
  navigation: {
    group: "operations",
    order: 11,
    icon: "file-text",
    visibleRoles: ["department_head", "deputy_head", "instructor", "committee_member"],
  },
  scope: { level: "department", scopeFrom: "parent" },
  parentSubject: {
    subjectType: "committee",
    relation: "parent",
    required: true,
    inheritPermissions: true,
    listUnderParent: true,
    createFromParent: true,
  },
  record: {
    numberPrefix: "CR",
    titleTemplate: "Report {{period_from}} to {{period_to}}",
    fields: [
      { key: "period_from", type: "date", label: "Period from", constraints: { required: true } },
      {
        key: "period_to",
        type: "date",
        label: "Period to",
        constraints: { required: true },
        helpText: "The report is due on the day the period ends.",
      },
    ],
    canCreate: [
      { type: "relationship", rel: "parent_member" },
      { type: "role", roles: ["department_head", "deputy_head"] },
      { type: "permission", key: "committee.report.submit" },
    ],
    ownerRule: { type: "creator" },
    backing: { kind: "module", adapter: "committee_report.backing" },
  },
  steps: [
    {
      kind: "step",
      key: "draft",
      label: "Being written",
      description: "The committee's own account of the period.",
      stepType: "form",
      assignee: { type: "relationship", rel: "parent_member" },
      deadline: { rule: "relative", offsetDays: 0, from: "record_field", fieldKey: "period_to" },
      reminders: { scheduleKey: "default_7_3_1_0_overdue", audience: "assignee" },
      form: {
        sectionTitle: "The period",
        questions: [
          {
            key: "progress_summary",
            type: "long_text",
            label: "What the committee did",
            constraints: { required: true },
          },
          {
            key: "completed_tasks",
            type: "task_picker",
            label: "A task the committee finished in the period",
            sourceBinding: "tasks_in_context",
            helpText: "Picking one here completes it when the report is submitted.",
          },
          { key: "recommendations", type: "long_text", label: "Recommendations" },
          {
            key: "issues_requiring_attention",
            type: "repeating_group",
            label: "Issues the committee cannot settle",
            helpText: "Each one becomes a case for the department when the head takes it forward.",
            fields: [
              {
                key: "issue",
                type: "long_text",
                label: "The issue",
                constraints: { required: true },
              },
              {
                key: "urgency",
                type: "single_choice",
                label: "Urgency",
                options: [
                  { value: "low", label: "Low" },
                  { value: "normal", label: "Normal" },
                  { value: "high", label: "High" },
                ],
                constraints: { required: true },
              },
            ],
          },
        ],
      },
      attachments: [
        { slotKey: "attachments", label: "Minutes and supporting documents", required: false },
      ],
      actions: [
        {
          key: "submit",
          label: "Submit the report",
          kind: "submit",
          to: "submitted",
          actors: [{ type: "assignee" }, { type: "owner" }],
          guards: ["committee.memberGuard"],
          requiredFields: ["progress_summary"],
          effects: ["committee_report.setSubmittedAt"],
          permission: "committee.report.submit",
        },
      ],
    },
    {
      kind: "step",
      key: "submitted",
      label: "With the head",
      description: "Waiting to be read.",
      stepType: "review",
      assignee: { type: "role", roles: ["department_head", "deputy_head"] },
      notifications: {
        onEnter: [
          {
            templateKey: "committee_report_submitted",
            to: "role:department_head",
            category: "workflow",
          },
        ],
      },
      actions: [
        {
          key: "review",
          label: "Take it forward",
          kind: "custom",
          to: "reviewed",
          actors: [
            { type: "assignee" },
            { type: "role", roles: ["department_head", "deputy_head"] },
          ],
          permission: "committee.manage",
        },
        {
          key: "request_revision",
          label: "Send it back",
          kind: "request_revision",
          to: "revision_required",
          actors: [
            { type: "assignee" },
            { type: "role", roles: ["department_head", "deputy_head"] },
          ],
          requiredComment: true,
          permission: "committee.manage",
        },
      ],
    },
    {
      kind: "step",
      key: "reviewed",
      label: "Being acted on",
      description: "Read, and now answered: the issues become cases, then the report is approved.",
      stepType: "review",
      assignee: { type: "role", roles: ["department_head", "deputy_head"] },
      actions: [
        {
          key: "escalate_issues",
          label: "Raise the issues as cases",
          kind: "custom",
          to: "$self",
          actors: [
            { type: "assignee" },
            { type: "role", roles: ["department_head", "deputy_head"] },
          ],
          effects: ["committee.escalateIssueToCase"],
          permission: "committee.manage",
        },
        {
          key: "approve",
          label: "Approve",
          kind: "approve",
          to: "approved",
          actors: [
            { type: "assignee" },
            { type: "role", roles: ["department_head", "deputy_head"] },
          ],
          effects: ["committee.completeReportedTasks"],
          permission: "committee.manage",
        },
        {
          key: "request_revision",
          label: "Send it back",
          kind: "request_revision",
          to: "revision_required",
          actors: [
            { type: "assignee" },
            { type: "role", roles: ["department_head", "deputy_head"] },
          ],
          requiredComment: true,
          permission: "committee.manage",
        },
      ],
    },
    {
      kind: "step",
      key: "revision_required",
      label: "Back with the committee",
      stepType: "form",
      assignee: { type: "owner" },
      notifications: {
        onEnter: [
          {
            templateKey: "committee_report_revision_required",
            to: "owner",
            category: "workflow",
          },
        ],
      },
      actions: [
        {
          key: "resubmit",
          label: "Submit again",
          kind: "submit",
          to: "submitted",
          actors: [{ type: "owner" }, { type: "assignee" }],
          guards: ["committee.memberGuard"],
          effects: ["committee_report.setSubmittedAt"],
          permission: "committee.report.submit",
        },
      ],
    },
  ],
  terminalStates: [{ key: "approved", label: "Approved", category: "success" }],
  listViews: [
    {
      key: "by_committee",
      label: "All reports",
      columns: [
        { field: "number", label: "Number" },
        { field: "parent", label: "Committee" },
        { field: "title", label: "Period" },
        { field: "state", label: "State" },
        { field: "owner", label: "Written by" },
      ],
      filters: [
        { field: "state", type: "state" },
        { field: "parent", type: "parent" },
        { field: "mine", type: "mine" },
      ],
    },
    {
      key: "pending_review",
      label: "Waiting for me",
      columns: [
        { field: "number", label: "Number" },
        { field: "parent", label: "Committee" },
        { field: "title", label: "Period" },
        { field: "deadline", label: "Due" },
      ],
      where: { states: ["submitted", "reviewed"] },
      visibleRoles: ["department_head", "deputy_head"],
    },
  ],
  dashboardCounters: [
    {
      key: "pending_reports",
      label: "Reports to read",
      where: { states: ["submitted", "reviewed"] },
      roles: ["department_head", "deputy_head"],
      link: "pending_review",
      tone: "warning",
    },
    {
      key: "my_reports_due",
      label: "Reports I owe",
      where: { states: ["draft", "revision_required"], assignedToMe: true },
      roles: ["committee_member", "committee_chair", "instructor"],
      link: "by_committee",
    },
  ],
  permissions: {
    defaults: {
      department_head: "full",
      deputy_head: "full",
      instructor: "assigned",
      committee_member: "assigned",
      committee_chair: "assigned",
    },
  },
};

export default committeeReport;
