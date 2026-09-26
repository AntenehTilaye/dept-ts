import type { SeedTemplate } from "./catalogue";

// The messages the committee module sends. They live here rather than in the kernel catalogue
// because the kernel does not know what a committee is: a module owns its own words, and a
// department may override any of these keys with a row of its own.

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

const RECORD = [
  "record_number",
  "record_title",
  "feature_name",
  "step_label",
  "committee_name",
  "period_from",
  "period_to",
].map((name) => ({ name, required: false }));

export const COMMITTEE_TEMPLATES: SeedTemplate[] = [
  {
    key: "committee_assignment",
    kind: "message",
    variables: [...COMMON, ...SUBJECT, ...RECORD],
    inApp: "You are chairing {{record_title}}",
    emailSubject: "[{{department_code}}] You are chairing {{record_title}}",
    emailBody:
      "Hello {{recipient_name}},\n\nThe committee {{record_title}} is now at work and you are its chair. Its members, its tasks and the reports it owes are all on its page.\n\nOpen it here: {{action_url}}\n\n{{department_name}}",
  },
  {
    key: "committee_report_submitted",
    kind: "message",
    variables: [...COMMON, ...SUBJECT, ...RECORD],
    inApp: "{{record_title}} was submitted and is waiting to be read",
    emailSubject: "[{{department_code}}] Committee report submitted: {{record_title}}",
    emailBody:
      "Hello {{recipient_name}},\n\n{{record_title}} has been submitted and is waiting for you.\n{{#comment}}\nNote: {{comment}}\n{{/comment}}\nAny issue the committee could not settle becomes a case when you take the report forward.\n\nOpen it here: {{action_url}}\n\n{{department_name}}",
  },
  {
    key: "committee_report_revision_required",
    kind: "message",
    variables: [...COMMON, ...SUBJECT, ...RECORD],
    inApp: "{{record_title}} was sent back: {{comment}}",
    emailSubject: "[{{department_code}}] Committee report sent back: {{record_title}}",
    emailBody:
      "Hello {{recipient_name}},\n\n{{record_title}} was sent back to the committee.\n\n{{comment}}\n\nOpen it here: {{action_url}}\n\n{{department_name}}",
  },
];
