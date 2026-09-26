import type { FeatureDefinitionInput } from "../../../src/platform/feature/schema";

// A committee, as a process. A department constitutes one, it works, it is stood down and
// eventually dissolved — so the states are the committee's own life rather than a paperwork
// trail, and the record that carries them IS the committee: its membership is a Group, which is
// what makes every grant, thread, audience and notification in the platform work on it unchanged.

export const committee: FeatureDefinitionInput = {
  schemaVersion: 1,
  key: "committee",
  name: "Committees",
  description:
    "A standing or ad hoc body of the department: who is on it, what it is for and what it has done.",
  labels: { singular: "Committee", plural: "Committees" },
  navigation: {
    group: "operations",
    order: 10,
    icon: "users",
    visibleRoles: ["department_head", "deputy_head", "instructor", "committee_member"],
  },
  scope: { level: "department" },
  record: {
    numberPrefix: "CM",
    titleTemplate: "{{name}}",
    fields: [
      {
        key: "name",
        type: "short_text",
        label: "Name",
        constraints: { required: true },
        helpText: "What the department calls it: Curriculum Committee, Ethics Review Panel, …",
      },
      { key: "purpose", type: "long_text", label: "Purpose" },
      {
        key: "type",
        type: "single_choice",
        label: "Type",
        options: [
          { value: "standing", label: "Standing" },
          { value: "ad_hoc", label: "Ad hoc" },
          { value: "review", label: "Review panel" },
        ],
      },
      { key: "start_date", type: "date", label: "Term of office from" },
      { key: "end_date", type: "date", label: "Term of office to" },
      {
        key: "chair",
        type: "person_picker",
        label: "Chair",
        sourceBinding: "staff_in_department",
        constraints: { required: true },
      },
      {
        key: "members",
        type: "multi_choice",
        label: "Members",
        sourceBinding: "staff_in_department",
        helpText: "The chair is a member whether or not they are ticked here.",
      },
      {
        key: "responsibilities",
        type: "long_text",
        label: "Responsibilities",
        helpText: "The mandate in words; the signed terms of reference are attached below.",
      },
    ],
    canCreate: [
      { type: "role", roles: ["department_head", "deputy_head"] },
      { type: "permission", key: "committee.manage" },
    ],
    ownerRule: { type: "creator" },
    backing: { kind: "module", adapter: "committee.backing" },
  },
  steps: [
    {
      kind: "step",
      key: "setup",
      label: "Being constituted",
      description: "Named, staffed and given its terms of reference — but not yet at work.",
      stepType: "upload",
      assignee: { type: "role", roles: ["department_head", "deputy_head"] },
      attachments: [
        {
          slotKey: "tor",
          label: "Terms of reference",
          required: true,
          maxFiles: 3,
        },
      ],
      actions: [
        {
          key: "activate",
          label: "Constitute the committee",
          kind: "complete",
          to: "active",
          actors: [
            { type: "role", roles: ["department_head", "deputy_head"] },
            { type: "permission", key: "committee.manage" },
          ],
          // the name and the chair are required when the record is created, so what is left to
          // ask for here is the mandate itself
          requiredAttachments: ["tor"],
          guards: ["committee.chairIsMember"],
          effects: ["committee.syncGroupStatus"],
        },
        {
          key: "abandon",
          label: "Do not constitute it",
          kind: "cancel",
          to: "abandoned",
          actors: [
            { type: "creator" },
            { type: "role", roles: ["department_head"] },
            { type: "permission", key: "committee.manage" },
          ],
          requiredComment: true,
          effects: ["committee.syncGroupStatus"],
        },
      ],
    },
    {
      kind: "step",
      key: "active",
      label: "At work",
      description: "Meeting, holding tasks and owing reports.",
      stepType: "wait",
      assignee: { type: "record_field", fieldKey: "chair" },
      notifications: {
        onEnter: [{ templateKey: "committee_assignment", to: "assignee", category: "assignment" }],
      },
      actions: [
        {
          key: "deactivate",
          label: "Stand it down",
          kind: "custom",
          to: "inactive",
          actors: [
            { type: "role", roles: ["department_head", "deputy_head"] },
            { type: "permission", key: "committee.manage" },
          ],
          requiredComment: true,
          effects: ["committee.syncGroupStatus"],
        },
      ],
    },
    {
      kind: "step",
      key: "inactive",
      label: "Stood down",
      description: "Not disbanded: the membership is closed but the record and its work remain.",
      stepType: "wait",
      assignee: { type: "role", roles: ["department_head", "deputy_head"] },
      actions: [
        {
          key: "reactivate",
          label: "Bring it back",
          kind: "reopen",
          to: "active",
          actors: [
            { type: "role", roles: ["department_head", "deputy_head"] },
            { type: "permission", key: "committee.manage" },
          ],
          effects: ["committee.syncGroupStatus"],
        },
        {
          key: "dissolve",
          label: "Dissolve it",
          kind: "cancel",
          to: "dissolved",
          actors: [
            { type: "role", roles: ["department_head"] },
            { type: "permission", key: "committee.manage" },
          ],
          requiredComment: true,
          effects: ["committee.syncGroupStatus"],
        },
      ],
    },
  ],
  terminalStates: [
    // a committee that was wound up did its job; one that was never constituted did not
    { key: "dissolved", label: "Dissolved", category: "success" },
    { key: "abandoned", label: "Never constituted", category: "cancelled" },
  ],
  listViews: [
    {
      key: "all",
      label: "All committees",
      columns: [
        { field: "number", label: "Number" },
        { field: "title", label: "Committee" },
        { field: "state", label: "State" },
        { field: "type", label: "Type" },
        { field: "createdAt", label: "Constituted" },
      ],
      filters: [
        { field: "state", type: "state" },
        { field: "mine", type: "mine" },
      ],
    },
    {
      key: "active",
      label: "At work",
      columns: [
        { field: "number", label: "Number" },
        { field: "title", label: "Committee" },
        { field: "chair", label: "Chair" },
      ],
      where: { states: ["active"] },
    },
    {
      key: "mine",
      label: "Mine",
      columns: [
        { field: "number", label: "Number" },
        { field: "title", label: "Committee" },
        { field: "state", label: "State" },
      ],
      filters: [{ field: "mine", type: "mine" }],
    },
  ],
  dashboardCounters: [
    {
      key: "active_committees",
      label: "Committees at work",
      where: { states: ["active"] },
      roles: ["department_head", "deputy_head"],
      link: "active",
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

export default committee;
