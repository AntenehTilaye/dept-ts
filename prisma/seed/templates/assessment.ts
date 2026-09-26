import type { SeedTemplate } from "./catalogue";

// The messages the assessment module sends. Marks arriving is news for whoever coordinates the
// course; an offering that will not run is news for whoever was going to teach it.

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

const COURSE = ["course_code", "course_title", "section_code", "student_count"].map((name) => ({
  name,
  required: false,
}));

export const ASSESSMENT_TEMPLATES: SeedTemplate[] = [
  {
    key: "assessment_committed",
    kind: "message",
    variables: [...COMMON, ...SUBJECT, ...COURSE],
    inApp: "Marks were committed for {{subject_label}}",
    emailSubject: "[{{department_code}}] Marks committed: {{subject_label}}",
    emailBody:
      "Hello {{recipient_name}},\n\nMarks were committed for {{subject_label}}{{#student_count}} ({{student_count}} student(s)){{/student_count}}. The results and the section's figures have been recomputed.\n\nOpen it here: {{action_url}}\n\n{{department_name}}",
  },
  {
    key: "offering_cancelled",
    kind: "message",
    variables: [...COMMON, ...SUBJECT, ...COURSE],
    inApp: "{{subject_label}} will not run this term",
    emailSubject: "[{{department_code}}] Not running: {{subject_label}}",
    emailBody:
      "Hello {{recipient_name}},\n\n{{subject_label}} will not run this term.\n{{#comment}}\nReason: {{comment}}\n{{/comment}}\nIf you were timetabled for it, your load will be revised.\n\n{{department_name}}",
  },
];
