import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/organization/access";

// Coarse department-membership roles for better-auth's organization plugin. They gate the
// plugin's own endpoints and navigation defaults; every fine-grained decision goes through
// can() in src/platform/identity (RolePermission rows + scoped RoleGrant rows).
// `committee_chair` is never a membership role: it exists only as a derived, scoped RoleGrant.
// The global System Administrator is the admin plugin's `user.role === "admin"`.

export const statement = {
  ...defaultStatements,
  feature: ["read", "create", "act", "manage"],
  committee: ["read", "manage"],
  task: ["read", "manage"],
  portfolio: ["read", "submit", "review", "approve"],
  campaign: ["read", "manage", "respond"],
  meeting: ["read", "manage"],
  appointment: ["read", "manage"],
  case: ["read", "manage"],
  admin: ["department"],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  department_head: ac.newRole({
    ...adminAc.statements,
    feature: ["read", "create", "act", "manage"],
    committee: ["read", "manage"],
    task: ["read", "manage"],
    portfolio: ["read", "review", "approve"],
    campaign: ["read", "manage"],
    meeting: ["read", "manage"],
    appointment: ["read", "manage"],
    case: ["read", "manage"],
    admin: ["department"],
  }),
  deputy_head: ac.newRole({
    feature: ["read", "create", "act", "manage"],
    committee: ["read", "manage"],
    task: ["read", "manage"],
    portfolio: ["read", "review"],
    campaign: ["read", "manage"],
    meeting: ["read", "manage"],
    appointment: ["read", "manage"],
    case: ["read", "manage"],
  }),
  instructor: ac.newRole({
    feature: ["read", "create", "act"],
    committee: ["read"],
    task: ["read"],
    portfolio: ["read", "submit"],
    campaign: ["read", "respond"],
    meeting: ["read"],
    appointment: ["read"],
  }),
  committee_member: ac.newRole({
    feature: ["read", "act"],
    committee: ["read"],
    task: ["read"],
    meeting: ["read"],
  }),
  student_rep: ac.newRole({
    feature: ["read", "create"],
    task: ["read"],
    campaign: ["read", "respond"],
    meeting: ["read"],
    appointment: ["read"],
  }),
  student: ac.newRole({
    campaign: ["read", "respond"],
    appointment: ["read"],
  }),
  lab_staff: ac.newRole({
    feature: ["read", "act"],
    task: ["read"],
  }),
};

export type OrgRoleKey = keyof typeof roles;
export const ORG_ROLE_KEYS = Object.keys(roles) as OrgRoleKey[];

/** Role keys that may appear in RoleGrant rows and permission matrices (membership + derived + global admin). */
export type RoleKey = OrgRoleKey | "committee_chair" | "admin";
export const ROLE_KEYS: RoleKey[] = [...ORG_ROLE_KEYS, "committee_chair", "admin"];

export function isOrgRoleKey(value: string): value is OrgRoleKey {
  return (ORG_ROLE_KEYS as string[]).includes(value);
}

/** Parses better-auth's comma-separated Member.role column into known membership roles. */
export function parseMemberRoles(role: string | null | undefined): OrgRoleKey[] {
  return (role ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(isOrgRoleKey);
}
