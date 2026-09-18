// System message/reminder templates (faculty rows). Every variant is validated against the
// declared variables at seed time; departments may override any key with their own row.
export interface SeedTemplate {
  key: string;
  kind: "message" | "reminder" | "document";
  contextType?: string;
  variables: Array<{ name: string; required: boolean; type?: string }>;
  inApp: string;
  emailSubject: string;
  emailBody: string;
}

const COMMON = [
  "recipient_name",
  "department_name",
  "department_code",
  "faculty_name",
  "term_name",
  "academic_year",
  "today",
  "action_url",
].map((name) => ({ name, required: false }));
const SUBJECT = ["subject_label", "state", "comment", "title", "body"].map((name) => ({
  name,
  required: false,
}));
const DEADLINE = [
  { name: "deadline", required: false },
  { name: "days", required: false, type: "number" },
];

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    key: "task_assignment",
    kind: "message",
    variables: [
      ...COMMON,
      ...SUBJECT,
      { name: "due_date", required: false },
      { name: "assigner_name", required: false },
    ],
    inApp: "You have been assigned: {{subject_label}}{{#due_date}} (due {{due_date}}){{/due_date}}",
    emailSubject: "[{{department_code}}] New assignment: {{subject_label}}",
    emailBody:
      "Hello {{recipient_name}},\n\nYou have been assigned {{subject_label}}{{#due_date}}, due {{due_date}}{{/due_date}}.\n{{#comment}}\nNote: {{comment}}\n{{/comment}}\nOpen it here: {{action_url}}\n\n{{department_name}}",
  },
  {
    key: "task_update_request",
    kind: "message",
    variables: [...COMMON, ...SUBJECT],
    inApp: "Update requested on {{subject_label}}: {{comment}}",
    emailSubject: "[{{department_code}}] Update requested: {{subject_label}}",
    emailBody:
      "Hello {{recipient_name}},\n\nAn update was requested on {{subject_label}}.\n\n{{comment}}\n\nOpen it here: {{action_url}}",
  },
  {
    key: "deadline_reminder",
    kind: "reminder",
    variables: [...COMMON, ...SUBJECT, ...DEADLINE],
    inApp: "Reminder: {{subject_label}} is due {{deadline}}",
    emailSubject: "[{{department_code}}] Reminder: {{subject_label}} due {{deadline}}",
    emailBody:
      "Hello {{recipient_name}},\n\nThis is a reminder that {{subject_label}} is due on {{deadline}} ({{days}} day(s) from now).\n\nOpen it here: {{action_url}}\n\n{{department_name}}",
  },
  {
    key: "deadline_overdue",
    kind: "reminder",
    variables: [...COMMON, ...SUBJECT, ...DEADLINE],
    inApp: "Overdue: {{subject_label}} was due {{deadline}}",
    emailSubject: "[{{department_code}}] Overdue: {{subject_label}}",
    emailBody:
      "Hello {{recipient_name}},\n\n{{subject_label}} was due on {{deadline}} and is now {{days}} day(s) overdue.\n\nOpen it here: {{action_url}}\n\n{{department_name}}",
  },
  {
    key: "mention",
    kind: "message",
    variables: [...COMMON, ...SUBJECT, { name: "author_name", required: false }],
    inApp: "{{author_name}} mentioned you on {{subject_label}}",
    emailSubject: "[{{department_code}}] {{author_name}} mentioned you",
    emailBody:
      "Hello {{recipient_name}},\n\n{{author_name}} mentioned you on {{subject_label}}:\n\n{{comment}}\n\nOpen it here: {{action_url}}",
  },
  {
    key: "report_ready",
    kind: "message",
    variables: [...COMMON, ...SUBJECT],
    inApp: "Your report {{subject_label}} is ready",
    emailSubject: "[{{department_code}}] Report ready: {{subject_label}}",
    emailBody:
      "Hello {{recipient_name}},\n\nYour report {{subject_label}} has been generated.\n\nDownload it here: {{action_url}}",
  },
  {
    key: "system_alert",
    kind: "message",
    variables: [...COMMON, ...SUBJECT],
    inApp: "{{title}}: {{body}}",
    emailSubject: "[{{department_code}}] {{title}}",
    emailBody: "{{body}}",
  },
  {
    key: "auth.set_password",
    kind: "message",
    variables: [...COMMON, { name: "url", required: true }, { name: "name", required: false }],
    inApp: "Set your password",
    emailSubject: "Set your DeptTS password",
    emailBody:
      "Hello {{name}},\n\nAn account has been created for you. Choose a password to start using DeptTS:\n{{url}}\n\nIf the link does not work, copy it into your browser.",
  },
  {
    key: "auth.reset_password",
    kind: "message",
    variables: [...COMMON, { name: "url", required: true }, { name: "name", required: false }],
    inApp: "Reset your password",
    emailSubject: "Reset your DeptTS password",
    emailBody:
      "Hello {{name}},\n\nUse this link to choose a new password:\n{{url}}\n\nIf you did not ask for this, ignore this message.",
  },
];
