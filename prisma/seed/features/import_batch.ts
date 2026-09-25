import type { FeatureDefinitionInput, StepDefInput } from "../../../src/platform/feature/schema";

// The staged import, as a feature. Reading a spreadsheet is a process somebody walks through —
// upload, look at what came out, fix the lines that are wrong, commit — so it is a record with
// states like everything else, and the pipeline supplies only the work each state does.
//
// One preset per kind of file. This phase registers `roster` and `class_timetable`; the
// assessment and attendance presets arrive with the portfolio phase, which changes the locked
// `/presets/*` subtree and therefore reaches an installation as a seed upgrade.

const discard = (): StepDefInput["actions"][number] => ({
  key: "discard",
  label: "Discard",
  kind: "cancel",
  to: "discarded",
  actors: [{ type: "creator" }, { type: "permission", key: "import.manage" }],
  requiredComment: false,
});

const step = (s: StepDefInput): StepDefInput => ({ ...s, actions: [...s.actions, discard()] });

const PRESETS = [
  ["roster", "Section roster", "section", "Students of one section for the year."],
  ["class_timetable", "Class timetable", "term", "Weekly slots for a whole term."],
] as const;

export const importBatch: FeatureDefinitionInput = {
  schemaVersion: 1,
  key: "import_batch",
  name: "Imports",
  description:
    "Read a spreadsheet into the department: upload it, see exactly what is wrong with which line, fix it and commit.",
  labels: { singular: "Import", plural: "Imports" },
  navigation: {
    group: "admin",
    order: 50,
    icon: "upload",
    visibleRoles: ["department_head", "deputy_head"],
    showInDashboard: false,
    showCounterInNav: false,
  },
  scope: { level: "department" },
  parentSubject: {
    subjectType: "section",
    relation: "context",
    required: false,
    listUnderParent: true,
    createFromParent: true,
    allowedTypes: ["section", "term", "section_offering", "course_offering"],
  },
  record: {
    numberPrefix: "IMP",
    titleTemplate: "{{file_name}}",
    fields: [
      { key: "kind", type: "short_text", label: "Kind", readOnly: true },
      {
        key: "file_name",
        type: "short_text",
        label: "File",
        constraints: { required: true },
        helpText: "The spreadsheet you are importing, as it is named.",
      },
      {
        key: "sheet_name",
        type: "short_text",
        label: "Sheet",
        helpText: "Left empty, the first sheet with rows is read.",
      },
      {
        key: "header_row",
        type: "number",
        label: "Header row",
        helpText: "Which row holds the column headings (1 unless the file has a title block).",
      },
      { key: "note", type: "long_text", label: "Note" },
    ],
    canCreate: [
      { type: "role", roles: ["department_head", "deputy_head"] },
      { type: "permission", key: "import.manage" },
    ],
    ownerRule: { type: "creator" },
    backing: { kind: "module", adapter: "import_batch.backing" },
  },
  presets: Object.fromEntries(
    PRESETS.map(([key, label, parentSubjectType, description]) => [
      key,
      {
        label,
        description,
        fieldDefaults: { kind: key },
        parentSubjectType,
        navLabel: label,
      },
    ]),
  ),
  steps: [
    step({
      kind: "step",
      key: "uploaded",
      label: "Uploaded",
      description: "The file as it arrived. Nothing has been interpreted yet.",
      stepType: "upload",
      assignee: { type: "creator" },
      surface: "grid",
      attachments: [{ slotKey: "source", label: "The spreadsheet", required: true }],
      actions: [
        {
          key: "parse",
          label: "Read the file",
          kind: "custom",
          to: "$next",
          actors: [{ type: "creator" }, { type: "permission", key: "import.manage" }],
          effects: ["import.parse"],
        },
      ],
    }),
    step({
      kind: "step",
      key: "parsed",
      label: "Columns",
      description: "Which column of the file is which field. A saved profile answers it for you.",
      stepType: "form",
      assignee: { type: "creator" },
      surface: "mapping",
      actions: [
        {
          key: "validate",
          label: "Check the rows",
          kind: "custom",
          to: "$next",
          actors: [{ type: "creator" }, { type: "permission", key: "import.manage" }],
          effects: ["import.validate"],
        },
      ],
    }),
    step({
      kind: "step",
      key: "validated",
      label: "Preview",
      description: "Every row, with what is wrong beside it. Fix a line and it is checked again.",
      stepType: "review",
      assignee: { type: "creator" },
      surface: "preview",
      actions: [
        {
          key: "commit",
          label: "Commit",
          kind: "approve",
          to: "committed",
          actors: [{ type: "creator" }, { type: "permission", key: "import.manage" }],
          guards: ["import.noRowsInError", "import.actorMayCommit"],
          effects: ["import.commit"],
          confirm: {
            title: "Commit this import?",
            message: "Every row will be written. The previous import of the same thing is replaced.",
          },
        },
        {
          key: "recheck",
          label: "Check again",
          kind: "custom",
          to: "validated",
          actors: [{ type: "creator" }, { type: "permission", key: "import.manage" }],
          effects: ["import.validate"],
        },
      ],
    }),
  ],
  terminalStates: [
    { key: "committed", label: "Committed", category: "success" },
    { key: "discarded", label: "Discarded", category: "cancelled" },
  ],
  listViews: [
    {
      key: "all",
      label: "All imports",
      columns: [
        { field: "number", label: "Number" },
        { field: "title", label: "File" },
        { field: "preset", label: "Kind" },
        { field: "state", label: "State" },
        { field: "owner", label: "Uploaded by" },
        { field: "createdAt", label: "Uploaded" },
      ],
      filters: [
        { field: "state", type: "state" },
        { field: "preset", type: "preset" },
        { field: "mine", type: "mine" },
      ],
      defaultSort: { field: "createdAt", dir: "desc" },
    },
    {
      key: "open",
      label: "Unfinished",
      columns: [
        { field: "number", label: "Number" },
        { field: "title", label: "File" },
        { field: "preset", label: "Kind" },
        { field: "state", label: "State" },
      ],
      where: { states: ["uploaded", "parsed", "validated"] },
    },
  ],
  permissions: {
    defaults: {
      department_head: "manage",
      deputy_head: "manage",
      instructor: "view",
    },
  },
};

export default importBatch;
