import type { PermissionLevelKey } from "./levels";
import type { RoleKey } from "../../lib/auth/access";

// The permission catalogue and the default matrix of section 30, as data. Seeded into
// Permission / Role / RolePermission (faculty rows, departmentId NULL) and editable per
// department by administrators. Later phases append their module keys here.

export interface PermissionDef {
  key: string;
  module: string;
  action: string;
  description: string;
}

function keys(module: string, actions: Record<string, string>): PermissionDef[] {
  return Object.entries(actions).map(([action, description]) => ({
    key: `${module}.${action}`,
    module,
    action,
    description,
  }));
}

export const PERMISSIONS: PermissionDef[] = [
  ...keys("admin", { department: "Administer department settings, members and roles" }),
  ...keys("academic", {
    manage:
      "Manage the academic registry: years, terms, periods, programs, courses, offerings, resources",
  }),
  ...keys("calendar", { manage: "Edit academic calendar periods" }),
  ...keys("committee", {
    view: "View committees",
    manage: "Create, edit, activate and deactivate committees; review committee reports",
    "task.manage": "Assign and manage committee tasks",
    "report.submit": "Submit committee progress reports",
  }),
  ...keys("task", {
    view: "View tasks",
    create: "Create tasks",
    act: "Act on assigned tasks (acknowledge, start, submit)",
    manage: "Assign, review, approve and cancel tasks",
  }),
  ...keys("portfolio", {
    view: "View course portfolios",
    submit_own: "Prepare and submit own course portfolios",
    review: "Review course portfolios and request revisions",
    approve: "Approve course portfolios",
  }),
  ...keys("assessment", { import: "Upload assessment results", view: "View assessment results" }),
  ...keys("cqi", { manage: "Manage CQI reports and actions" }),
  ...keys("evaluation", {
    create: "Create staff evaluations",
    manage: "Manage staff evaluations",
    close: "Close staff evaluations",
    analyze: "Analyze staff evaluation results",
    view_subject_report: "View the evaluation report of an instructor",
    view_own: "View own evaluation results",
    participate: "Respond to evaluations",
  }),
  ...keys("add_drop", {
    manage: "Run add/drop campaigns and decide offerings",
    submit: "Submit add/drop requests",
  }),
  ...keys("elective", {
    manage: "Run elective campaigns and decide offerings",
    submit: "Submit elective preferences",
  }),
  ...keys("preference", {
    manage: "Collect and analyze course preferences",
    submit: "Submit course preferences",
  }),
  ...keys("campaign", { manage: "Run campaigns of any kind", respond: "Respond to campaigns" }),
  ...keys("load", { manage: "Run load-assignment cycles and exports" }),
  ...keys("meeting", { view: "View meetings", manage: "Schedule meetings and produce minutes" }),
  ...keys("minutes", { approve: "Approve meeting minutes" }),
  ...keys("appointment", {
    manage: "Manage appointment availability and requests",
    request: "Request appointments",
  }),
  ...keys("case", { manage: "Assign and resolve cases" }),
  ...keys("plan", {
    manage: "Prepare annual plans and quarterly reports",
    approve: "Approve annual plans and quarterly reports",
  }),
  ...keys("staff", {
    view: "View staff profiles",
    manage: "Manage staff profiles",
    own: "Edit own staff profile",
  }),
  ...keys("resource", {
    view: "View resources and assets",
    manage: "Manage resources, assets and maintenance",
  }),
  ...keys("lab", {
    manage: "Manage laboratory schedules and duties",
    view_own: "View own lab duties",
    "task.manage": "Manage lab activity tasks",
  }),
  ...keys("invigilation", {
    manage: "Manage examination schedules and invigilation duties",
    view_own: "View own invigilation duties",
  }),
  ...keys("communication", { manage: "Manage announcements and representatives" }),
  ...keys("document", { read: "Read documents", manage: "Manage documents" }),
  ...keys("report", { generate: "Generate reports" }),
  ...keys("feature", { manage: "Administer feature definitions" }),
];

export const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.key));

export interface RoleDef {
  key: RoleKey;
  name: string;
  description: string;
}

export const ROLES: RoleDef[] = [
  { key: "department_head", name: "Department Head", description: "Full departmental management" },
  {
    key: "deputy_head",
    name: "Deputy Department Head",
    description: "Operational management; approvals excluded by setting",
  },
  { key: "instructor", name: "Instructor", description: "Teaching staff" },
  {
    key: "committee_member",
    name: "Committee Member",
    description: "Member of one or more committees (derived, committee-scoped)",
  },
  {
    key: "committee_chair",
    name: "Committee Chair",
    description: "Chair of a committee (derived, committee-scoped; never a membership role)",
  },
  {
    key: "student_rep",
    name: "Student Representative",
    description: "Section representative (derived, section-scoped)",
  },
  { key: "student", name: "Student", description: "Student with a login" },
  {
    key: "lab_staff",
    name: "Lab Instructor / RA",
    description: "Laboratory staff (derived, lab-schedule-scoped)",
  },
];

export interface MatrixRow {
  role: RoleKey;
  key: string;
  level: PermissionLevelKey;
}

function grant(role: RoleKey, level: PermissionLevelKey, permissionKeys: string[]): MatrixRow[] {
  return permissionKeys.map((key) => ({ role, key, level }));
}

const ALL = PERMISSIONS.map((p) => p.key);

/** Keys the deputy head holds at `manage` but that rbac.manageExcludedPermissions withholds by default. */
export const DEFAULT_MANAGE_EXCLUDED = [
  "portfolio.approve",
  "evaluation.close",
  "evaluation.analyze",
  "plan.approve",
  "minutes.approve",
];

export const MATRIX: MatrixRow[] = [
  ...grant(
    "department_head",
    "full",
    ALL.filter((k) => k !== "feature.manage"),
  ),
  ...grant(
    "deputy_head",
    "manage",
    ALL.filter((k) => k !== "feature.manage" && k !== "admin.department"),
  ),
  ...grant("instructor", "assigned", ["committee.view", "task.view", "task.act", "meeting.view"]),
  ...grant("instructor", "own", [
    "task.create",
    "portfolio.view",
    "portfolio.submit_own",
    "assessment.import",
    "assessment.view",
    "cqi.manage",
    "evaluation.view_own",
    "staff.own",
  ]),
  ...grant("instructor", "participate", ["evaluation.participate", "campaign.respond"]),
  ...grant("instructor", "submit", ["preference.submit", "appointment.request"]),
  ...grant("instructor", "view", [
    "staff.view",
    "resource.view",
    "document.read",
    "lab.view_own",
    "invigilation.view_own",
  ]),
  ...grant("committee_member", "assigned", [
    "committee.view",
    "committee.report.submit",
    "task.view",
    "task.act",
    "meeting.view",
  ]),
  ...grant("committee_member", "view", ["document.read"]),
  ...grant("committee_chair", "assigned", [
    "committee.view",
    "committee.task.manage",
    "committee.report.submit",
    "task.view",
    "task.act",
    "task.create",
    "meeting.view",
    "meeting.manage",
  ]),
  ...grant("committee_chair", "view", ["document.read"]),
  ...grant("student_rep", "limited", ["task.view", "meeting.view"]),
  ...grant("student_rep", "participate", ["evaluation.participate", "campaign.respond"]),
  ...grant("student_rep", "submit", ["add_drop.submit", "elective.submit", "appointment.request"]),
  ...grant("student_rep", "view", ["document.read"]),
  ...grant("student", "participate", ["evaluation.participate", "campaign.respond"]),
  ...grant("student", "submit", ["add_drop.submit", "elective.submit", "appointment.request"]),
  ...grant("lab_staff", "assigned", ["task.view", "task.act", "task.create", "lab.task.manage"]),
  ...grant("lab_staff", "view", ["lab.view_own", "resource.view", "document.read"]),
];

/** The default level of a role for a key (undefined = no row). */
export function defaultLevel(role: RoleKey, key: string): PermissionLevelKey | undefined {
  return MATRIX.find((r) => r.role === role && r.key === key)?.level;
}
