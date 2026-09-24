import type { FeatureDefinitionInput } from "../../../src/platform/feature/schema";

// The sample process, and the one the wizard offers as a starting point when an administrator
// clones: someone files a request, two reviewers look at it in parallel (either one may carry
// it), and the head decides. It references no adapter and no module, so it is also the honest
// proof that a useful feature can be composed entirely in the builder.

export const genericRequest: FeatureDefinitionInput = {
  schemaVersion: 1,
  key: "generic_request",
  name: "Requests",
  description: "A request that is reviewed and then approved or refused.",
  labels: { singular: "Request", plural: "Requests" },
  navigation: {
    group: "operations",
    order: 20,
    icon: "inbox",
    visibleRoles: ["department_head", "deputy_head", "instructor", "committee_member", "lab_staff"],
  },
  scope: { level: "department" },
  record: {
    numberPrefix: "GR",
    titleTemplate: "{{subject}}",
    fields: [
      { key: "subject", type: "short_text", label: "Subject", constraints: { required: true } },
      { key: "details", type: "long_text", label: "Details", constraints: { required: true } },
      {
        key: "urgency",
        type: "single_choice",
        label: "Urgency",
        options: [
          { value: "routine", label: "Routine" },
          { value: "soon", label: "Within the week" },
          { value: "urgent", label: "Urgent" },
        ],
      },
    ],
    canCreate: [
      { type: "role", roles: ["instructor", "committee_member", "lab_staff", "deputy_head", "department_head"] },
    ],
    ownerRule: { type: "creator" },
    backing: { kind: "feature_record" },
  },
  steps: [
    {
      kind: "step",
      key: "request",
      label: "Request",
      stepType: "form",
      assignee: { type: "creator" },
      attachments: [
        { slotKey: "supporting_document", label: "Supporting document", required: false },
      ],
      actions: [
        {
          key: "submit",
          label: "Submit",
          kind: "submit",
          to: "$next",
          actors: [{ type: "creator" }],
          requiredFields: ["subject", "details"],
        },
        {
          key: "withdraw",
          label: "Withdraw",
          kind: "cancel",
          to: "withdrawn",
          actors: [{ type: "creator" }],
          requiredComment: true,
        },
      ],
    },
    {
      kind: "parallel",
      key: "review",
      label: "Review",
      branches: {
        mode: "static",
        items: [
          {
            key: "deputy",
            label: "Deputy head",
            steps: [
              {
                kind: "step",
                key: "deputy_review",
                label: "Deputy review",
                stepType: "review",
                assignee: { type: "role", roles: ["deputy_head"] },
                deadline: { rule: "relative", offsetDays: 5, from: "step_entered" },
                reminders: { scheduleKey: "default_7_3_1_0_overdue", audience: "assignee" },
                actions: [
                  {
                    key: "endorse",
                    label: "Endorse",
                    kind: "approve",
                    to: "$next",
                    actors: [{ type: "assignee" }],
                  },
                  {
                    key: "refuse",
                    label: "Refuse",
                    kind: "reject",
                    to: "rejected",
                    actors: [{ type: "assignee" }],
                    requiredComment: true,
                  },
                ],
              },
            ],
          },
          {
            key: "committee",
            label: "Committee",
            steps: [
              {
                kind: "step",
                key: "committee_review",
                label: "Committee review",
                stepType: "review",
                assignee: { type: "role", roles: ["committee_member"] },
                deadline: { rule: "relative", offsetDays: 5, from: "step_entered" },
                reminders: { scheduleKey: "default_7_3_1_0_overdue", audience: "assignee" },
                actions: [
                  {
                    key: "endorse",
                    label: "Endorse",
                    kind: "approve",
                    to: "$next",
                    actors: [{ type: "assignee" }],
                  },
                  {
                    key: "refuse",
                    label: "Refuse",
                    kind: "reject",
                    to: "rejected",
                    actors: [{ type: "assignee" }],
                    requiredComment: true,
                  },
                ],
              },
            ],
          },
        ],
      },
      // one endorsement is enough; a refusal ends the whole request
      completion: { rule: "quorum", n: 1 },
      onComplete: "$next",
      onAnyReject: "rejected",
    },
    {
      kind: "step",
      key: "decision",
      label: "Decision",
      stepType: "review",
      assignee: { type: "role", roles: ["department_head"] },
      deadline: { rule: "relative", offsetDays: 3, from: "step_entered" },
      reminders: { scheduleKey: "default_7_3_1_0_overdue", audience: "assignee" },
      actions: [
        {
          key: "approve",
          label: "Approve",
          kind: "approve",
          to: "approved",
          actors: [{ type: "assignee" }, { type: "role", roles: ["department_head"] }],
        },
        {
          key: "refuse",
          label: "Refuse",
          kind: "reject",
          to: "rejected",
          actors: [{ type: "assignee" }, { type: "role", roles: ["department_head"] }],
          requiredComment: true,
        },
        {
          key: "send_back",
          label: "Ask for changes",
          kind: "request_revision",
          to: "request",
          actors: [{ type: "assignee" }, { type: "role", roles: ["department_head"] }],
          requiredComment: true,
        },
      ],
    },
  ],
  terminalStates: [
    { key: "approved", label: "Approved", category: "success" },
    { key: "rejected", label: "Refused", category: "rejected" },
    { key: "withdrawn", label: "Withdrawn", category: "cancelled" },
  ],
  listViews: [
    {
      key: "all",
      label: "All requests",
      columns: [
        { field: "number", label: "Number" },
        { field: "title", label: "Subject" },
        { field: "state", label: "State" },
        { field: "owner", label: "Requester" },
        { field: "deadline", label: "Due" },
      ],
      filters: [
        { field: "state", type: "state" },
        { field: "mine", type: "mine" },
        { field: "overdue", type: "overdue" },
      ],
    },
    {
      key: "waiting",
      label: "Waiting for me",
      columns: [
        { field: "number", label: "Number" },
        { field: "title", label: "Subject" },
        { field: "state", label: "State" },
      ],
      where: { states: ["review", "decision"] },
    },
  ],
  dashboardCounters: [
    {
      key: "to_decide",
      label: "Requests to decide",
      where: { states: ["decision"] },
      roles: ["department_head"],
      link: "waiting",
      tone: "warning",
    },
  ],
  permissions: {
    defaults: {
      department_head: "manage",
      deputy_head: "review",
      committee_member: "review",
      instructor: "own",
      lab_staff: "own",
      student_rep: "own",
    },
  },
};

export default genericRequest;
