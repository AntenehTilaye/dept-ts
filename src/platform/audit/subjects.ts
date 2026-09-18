// Which Prisma models are audited and how their rows map to a SubjectRef. Models whose
// snake_case name is a SubjectType member map by convention; the rest are listed here. Models
// missing from both are not audited (auth internals, projections, the audit tables themselves).

import { SubjectType } from "@/generated/prisma/enums";

type Row = Record<string, unknown>;

export interface AuditSubjectMapping {
  subjectType: string;
  subjectId: (row: Row) => string;
}

const SUBJECT_TYPES = new Set<string>(Object.values(SubjectType));

const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

const EXPLICIT: Record<string, AuditSubjectMapping> = {
  User: { subjectType: "user", subjectId: (r) => String(r.id) },
  Member: { subjectType: "user", subjectId: (r) => String(r.userId) },
  RoleGrant: { subjectType: "user", subjectId: (r) => String(r.userId) },
  Role: { subjectType: "department", subjectId: (r) => String(r.departmentId ?? "faculty") },
  RolePermission: {
    subjectType: "department",
    subjectId: (r) => String(r.departmentId ?? "faculty"),
  },
  Permission: { subjectType: "department", subjectId: () => "faculty" },
  SystemSetting: {
    subjectType: "department",
    subjectId: (r) => (r.scope === "department" ? String(r.scopeId) : "faculty"),
  },
  DepartmentPerson: { subjectType: "person", subjectId: (r) => String(r.personId) },
  StaffProfile: { subjectType: "staff_profile", subjectId: (r) => String(r.personId) },
  Student: { subjectType: "student", subjectId: (r) => String(r.personId) },
  ProfileItem: { subjectType: "person", subjectId: (r) => String(r.personId) },
  ClassTimetableSlot: {
    subjectType: "section_offering",
    subjectId: (r) => String(r.sectionOfferingId),
  },
  WorkflowDefinition: { subjectType: "feature_definition", subjectId: (r) => String(r.key) },
  WorkflowInstance: { subjectType: "workflow_instance", subjectId: (r) => String(r.id) },
};

/** Never audited. */
export const EXCLUDED_MODELS = new Set([
  "AuditEvent",
  "DomainEvent",
  "EventHandlerReceipt",
  "Session",
  "Verification",
  "Account",
  "Organization",
  "Invitation",
  "WorkflowTransitionLog",
  "SearchIndexEntry",
  "DashboardProjection",
]);

export function auditSubjectOf(model: string): AuditSubjectMapping | null {
  if (EXCLUDED_MODELS.has(model)) return null;
  const explicit = EXPLICIT[model];
  if (explicit) return explicit;
  const key = snake(model);
  if (SUBJECT_TYPES.has(key)) return { subjectType: key, subjectId: (r) => String(r.id) };
  return null;
}

/** Columns whose changes carry no information for a reviewer. */
export const IGNORED_FIELDS = new Set(["updatedAt", "rowVersion", "createdAt"]);
