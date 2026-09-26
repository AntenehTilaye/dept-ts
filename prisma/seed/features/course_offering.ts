import type { FeatureDefinitionInput } from "../../../src/platform/feature/schema";

// A course taught in a term, as a process. A department plans an offering, confirms it once there
// is somebody to teach it and a section to teach, and it then runs for the teaching period — which
// is a date the academic calendar already knows, so the record moves itself rather than waiting for
// somebody to remember. When it is over, the marks are in and the figures are frozen.

export const courseOffering: FeatureDefinitionInput = {
  schemaVersion: 1,
  key: "course_offering",
  name: "Offerings",
  description: "A course taught in a term: who coordinates it, which sections take it, how it is marked.",
  labels: { singular: "Offering", plural: "Offerings" },
  navigation: {
    group: "academic",
    order: 5,
    icon: "graduation-cap",
    visibleRoles: ["department_head", "deputy_head", "instructor"],
  },
  scope: { level: "department" },
  parentSubject: {
    subjectType: "course",
    relation: "parent",
    required: true,
    inheritPermissions: true,
    listUnderParent: true,
    createFromParent: true,
  },
  record: {
    numberPrefix: "CO",
    titleTemplate: "{{feature_name}} {{number}}",
    fields: [
      {
        key: "term",
        type: "term_picker",
        label: "Term",
        constraints: { required: true },
        // the term is what the offering IS; moving it would move every mark under it
        locked: true,
      },
      {
        key: "coordinator",
        type: "person_picker",
        label: "Coordinator",
        sourceBinding: "staff_in_department",
        helpText: "Who answers for this offering: the scheme, the sections, the portfolio.",
      },
      {
        key: "decision_note",
        type: "long_text",
        label: "Note",
        helpText: "Why it was confirmed, deferred or stood down.",
      },
    ],
    canCreate: [
      { type: "role", roles: ["department_head", "deputy_head"] },
      { type: "permission", key: "academic.manage" },
    ],
    ownerRule: { type: "creator" },
    backing: { kind: "module", adapter: "course_offering.backing" },
  },
  steps: [
    {
      kind: "step",
      key: "planned",
      label: "Planned",
      description: "On the timetable for the term, but not yet settled.",
      stepType: "form",
      assignee: { type: "role", roles: ["department_head", "deputy_head"] },
      actions: [
        {
          key: "confirm",
          label: "Confirm it",
          kind: "complete",
          to: "confirmed",
          actors: [
            { type: "role", roles: ["department_head", "deputy_head"] },
            { type: "permission", key: "academic.manage" },
          ],
        },
        {
          key: "cancel",
          label: "Do not run it",
          kind: "cancel",
          to: "cancelled",
          actors: [
            { type: "role", roles: ["department_head"] },
            { type: "permission", key: "academic.manage" },
          ],
          requiredComment: true,
          effects: ["offering.notifyCancelled"],
        },
      ],
    },
    {
      kind: "step",
      key: "confirmed",
      label: "Confirmed",
      description: "Staffed and sectioned, waiting for teaching to begin.",
      stepType: "wait",
      assignee: { type: "record_field", fieldKey: "coordinator" },
      // teaching starts when the calendar says it does
      deadline: { rule: "calendar", periodKind: "teaching", edge: "start", offsetDays: 0 },
      actions: [
        {
          key: "start",
          label: "Begin teaching",
          kind: "custom",
          to: "running",
          actors: [
            { type: "role", roles: ["department_head", "deputy_head"] },
            { type: "permission", key: "academic.manage" },
          ],
        },
        {
          key: "auto_start",
          label: "Begin teaching automatically",
          kind: "auto",
          to: "running",
          actors: [{ type: "system" }],
          auto: { when: "deadline" },
        },
        {
          key: "cancel",
          label: "Do not run it",
          kind: "cancel",
          to: "cancelled",
          actors: [
            { type: "role", roles: ["department_head"] },
            { type: "permission", key: "academic.manage" },
          ],
          requiredComment: true,
          effects: ["offering.notifyCancelled"],
        },
      ],
    },
    {
      kind: "step",
      key: "running",
      label: "Running",
      description: "Being taught. Marks are imported against its sections while it runs.",
      stepType: "wait",
      assignee: { type: "record_field", fieldKey: "coordinator" },
      deadline: { rule: "calendar", periodKind: "teaching", edge: "end", offsetDays: 0 },
      actions: [
        {
          key: "complete",
          label: "Close it",
          kind: "complete",
          to: "completed",
          actors: [
            { type: "role", roles: ["department_head", "deputy_head"] },
            { type: "permission", key: "academic.manage" },
          ],
          effects: ["offering.freezeSnapshots"],
        },
        {
          key: "auto_complete",
          label: "Close it automatically",
          kind: "auto",
          to: "completed",
          actors: [{ type: "system" }],
          auto: { when: "deadline" },
          effects: ["offering.freezeSnapshots"],
        },
      ],
    },
  ],
  terminalStates: [
    { key: "completed", label: "Completed", category: "success" },
    { key: "cancelled", label: "Not run", category: "cancelled" },
  ],
  listViews: [
    {
      key: "all",
      label: "All offerings",
      columns: [
        { field: "number", label: "Number" },
        { field: "parent", label: "Course" },
        { field: "state", label: "State" },
        { field: "coordinator", label: "Coordinator" },
        { field: "deadline", label: "Next date" },
      ],
      filters: [
        { field: "state", type: "state" },
        { field: "parent", type: "parent" },
        { field: "mine", type: "mine" },
      ],
    },
    {
      key: "running",
      label: "Being taught",
      columns: [
        { field: "number", label: "Number" },
        { field: "parent", label: "Course" },
        { field: "coordinator", label: "Coordinator" },
      ],
      where: { states: ["running"] },
    },
  ],
  dashboardCounters: [
    {
      key: "offerings_running",
      label: "Courses being taught",
      where: { states: ["running"] },
      roles: ["department_head", "deputy_head"],
      link: "running",
    },
  ],
  permissions: {
    defaults: {
      department_head: "full",
      deputy_head: "full",
      instructor: "view",
    },
  },
};

export default courseOffering;
