import { parseMemberRoles } from "../../lib/auth/access";
import { prismaRoot } from "../../lib/db/prisma";
import { withTenantTx } from "../../lib/db/tenant";
import type { Db } from "../../lib/db/types";

// Derived RoleGrant synchronisation: the rule table that turns registry facts into scoped,
// time-bounded grants. Every rule is idempotent, copies validFrom/validTo from its source row,
// and expires rather than deletes. Rules:
//   Member.role (department membership)      -> <role>@department
//   GroupMembership (kind = committee)       -> committee_member@committee (+ committee_chair for chairs)
//   SectionRepresentative                    -> student_rep@section
//   TeachingAssignment                       -> instructor@section_offering
//   StudentSectionMembership                 -> student@section
// The people/academic services call these synchronously; the outbox phase re-wires them to
// subscribers and the nightly reconcile repairs drift.

export type DerivedScope =
  | "department"
  | "committee"
  | "section"
  | "program"
  | "section_offering"
  | "lab_schedule"
  | "meeting"
  | "feature_record";
export type DerivedSource =
  | "user"
  | "group_membership"
  | "section_representative"
  | "teaching_assignment"
  | "student_section_membership"
  | "duty_assignment";

export interface DerivedGrantSpec {
  userId: string;
  roleKey: string;
  scopeType: DerivedScope;
  scopeId: string;
  derivedFromType: DerivedSource;
  derivedFromId: string;
  validFrom?: Date;
  validTo?: Date | null;
}

/** Resolves a role key to the department override or the faculty default row id. */
export async function roleIdFor(tx: Db, departmentId: string, roleKey: string): Promise<string> {
  const rows = await tx.role.findMany({
    where: { key: roleKey, OR: [{ departmentId }, { departmentId: null }] },
  });
  const role =
    rows.find((r) => r.departmentId === departmentId) ?? rows.find((r) => r.departmentId === null);
  if (!role) throw new Error(`Role "${roleKey}" is not seeded`);
  return role.id;
}

/** Ensures the derived grant exists with the source's validity; reopens an expired one. */
export async function upsertDerivedGrant(
  tx: Db,
  departmentId: string,
  spec: DerivedGrantSpec,
  now = new Date(),
): Promise<string> {
  const roleId = await roleIdFor(tx, departmentId, spec.roleKey);
  const identity = {
    userId: spec.userId,
    roleId,
    scopeType: spec.scopeType,
    scopeId: spec.scopeId,
    derivedFromId: spec.derivedFromId,
  };
  const validity = { validFrom: spec.validFrom ?? now, validTo: spec.validTo ?? null };
  await tx.roleGrant.upsert({
    where: { userId_roleId_scopeType_scopeId_derivedFromId: identity },
    update: { ...validity, source: "derived", derivedFromType: spec.derivedFromType },
    create: {
      ...identity,
      departmentId,
      source: "derived",
      derivedFromType: spec.derivedFromType,
      ...validity,
    },
  });
  return roleId;
}

/** Expires (never deletes) open derived grants of a source whose role is not in `keepRoleIds`. */
export async function expireDerivedGrants(
  tx: Db,
  where: { userId?: string; derivedFromType: DerivedSource; derivedFromId: string },
  keepRoleIds: ReadonlySet<string>,
  now = new Date(),
): Promise<number> {
  const open = await tx.roleGrant.findMany({
    where: { ...where, source: "derived", validTo: null },
  });
  const stale = open.filter((g) => !keepRoleIds.has(g.roleId));
  if (stale.length === 0) return 0;
  await tx.roleGrant.updateMany({
    where: { id: { in: stale.map((g) => g.id) } },
    data: { validTo: now },
  });
  return stale.length;
}

/** Applies the specs of one source row and expires that source's other open grants. */
async function syncSource(
  tx: Db,
  departmentId: string,
  source: { derivedFromType: DerivedSource; derivedFromId: string },
  specs: Omit<DerivedGrantSpec, "derivedFromType" | "derivedFromId">[],
  now = new Date(),
): Promise<void> {
  const keep = new Set<string>();
  for (const spec of specs) {
    keep.add(await upsertDerivedGrant(tx, departmentId, { ...spec, ...source }, now));
  }
  await expireDerivedGrants(tx, source, keep, now);
}

/**
 * Department-membership rule: every role in Member.role becomes a department-scoped derived
 * grant; roles no longer listed (or a removed membership) are expired.
 */
export async function syncMemberGrants(
  userId: string,
  organizationId: string,
  now = new Date(),
): Promise<void> {
  const member = await prismaRoot.member.findFirst({ where: { userId, organizationId } });
  const roleKeys = parseMemberRoles(member?.role);
  await withTenantTx(organizationId, (tx) =>
    syncSource(
      tx,
      organizationId,
      { derivedFromType: "user", derivedFromId: userId },
      roleKeys.map((roleKey) => ({
        userId,
        roleKey,
        scopeType: "department" as const,
        scopeId: "",
      })),
      now,
    ),
  );
}

/** The scope id a committee group grants into: its committee when linked, else the group itself. */
export function committeeScopeId(group: {
  id: string;
  contextType: string | null;
  contextId: string | null;
}): string {
  return group.contextType === "committee" && group.contextId ? group.contextId : group.id;
}

/**
 * Committee-group rule for one membership row: member -> committee_member, chair -> also
 * committee_chair, both scoped to the committee. Validity follows the membership and the
 * group status (an inactive group closes every grant at deactivatedAt).
 */
export async function syncGroupMembershipGrants(
  tx: Db,
  departmentId: string,
  membershipId: string,
  now = new Date(),
) {
  const m = await tx.groupMembership.findUnique({
    where: { id: membershipId },
    include: { group: true, person: { select: { userId: true } } },
  });
  const source = { derivedFromType: "group_membership" as const, derivedFromId: membershipId };
  if (!m || m.group.kind !== "committee" || !m.person.userId) {
    await expireDerivedGrants(tx, source, new Set(), now);
    return;
  }
  const closedAt = m.group.status === "inactive" ? (m.group.deactivatedAt ?? now) : null;
  const validTo = m.validTo ?? closedAt;
  const base = {
    userId: m.person.userId,
    scopeType: "committee" as const,
    scopeId: committeeScopeId(m.group),
    validFrom: m.validFrom,
    validTo,
  };
  const specs = [{ ...base, roleKey: "committee_member" }];
  if (m.roleInGroup === "chair") specs.push({ ...base, roleKey: "committee_chair" });
  await syncSource(tx, departmentId, source, specs, now);
}

/** Re-runs the membership rule for every membership of a group (status changes, reactivation). */
export async function syncGroupGrants(
  tx: Db,
  departmentId: string,
  groupId: string,
  now = new Date(),
) {
  const memberships = await tx.groupMembership.findMany({
    where: { groupId },
    select: { id: true },
  });
  for (const m of memberships) await syncGroupMembershipGrants(tx, departmentId, m.id, now);
}

/** Section-representative rule: student_rep@section for the representative's validity. */
export async function syncRepresentativeGrants(
  tx: Db,
  departmentId: string,
  representativeId: string,
  now = new Date(),
) {
  const rep = await tx.sectionRepresentative.findUnique({
    where: { id: representativeId },
    include: { student: { include: { person: { select: { userId: true } } } } },
  });
  const source = {
    derivedFromType: "section_representative" as const,
    derivedFromId: representativeId,
  };
  if (!rep || !rep.student.person.userId) {
    await expireDerivedGrants(tx, source, new Set(), now);
    return;
  }
  const spec = {
    userId: rep.student.person.userId,
    roleKey: "student_rep",
    scopeType: "section" as const,
    scopeId: rep.sectionId,
    validFrom: rep.validFrom,
    validTo: rep.validTo,
  };
  await syncSource(tx, departmentId, source, [spec], now);
}

/** Teaching rule: instructor@section_offering for the assignment's validity. */
export async function syncTeachingGrants(
  tx: Db,
  departmentId: string,
  teachingAssignmentId: string,
  now = new Date(),
) {
  const ta = await tx.teachingAssignment.findUnique({
    where: { id: teachingAssignmentId },
    include: { person: { select: { userId: true } } },
  });
  const source = {
    derivedFromType: "teaching_assignment" as const,
    derivedFromId: teachingAssignmentId,
  };
  if (!ta || !ta.person.userId) {
    await expireDerivedGrants(tx, source, new Set(), now);
    return;
  }
  const spec = {
    userId: ta.person.userId,
    roleKey: "instructor",
    scopeType: "section_offering" as const,
    scopeId: ta.sectionOfferingId,
    validFrom: ta.validFrom,
    validTo: ta.validTo,
  };
  await syncSource(tx, departmentId, source, [spec], now);
}

/** Student-section rule: student@section for each of the student's memberships. */
export async function syncStudentSectionGrants(
  tx: Db,
  departmentId: string,
  studentId: string,
  now = new Date(),
) {
  const student = await tx.student.findUnique({
    where: { personId: studentId },
    include: { person: { select: { userId: true } }, sectionMemberships: true },
  });
  if (!student) return;
  for (const m of student.sectionMemberships) {
    const source = { derivedFromType: "student_section_membership" as const, derivedFromId: m.id };
    if (!student.person.userId) {
      await expireDerivedGrants(tx, source, new Set(), now);
      continue;
    }
    const spec = {
      userId: student.person.userId,
      roleKey: "student",
      scopeType: "section" as const,
      scopeId: m.sectionId,
      validFrom: m.validFrom,
      validTo: m.validTo,
    };
    await syncSource(tx, departmentId, source, [spec], now);
  }
}

/** Re-derives every scoped grant of a person after they gain a login (Person.userId set). */
export async function syncPersonGrants(
  tx: Db,
  departmentId: string,
  personId: string,
  now = new Date(),
) {
  const memberships = await tx.groupMembership.findMany({
    where: { personId },
    select: { id: true },
  });
  for (const m of memberships) await syncGroupMembershipGrants(tx, departmentId, m.id, now);
  const reps = await tx.sectionRepresentative.findMany({
    where: { studentId: personId },
    select: { id: true },
  });
  for (const r of reps) await syncRepresentativeGrants(tx, departmentId, r.id, now);
  const teaching = await tx.teachingAssignment.findMany({
    where: { personId },
    select: { id: true },
  });
  for (const t of teaching) await syncTeachingGrants(tx, departmentId, t.id, now);
  await syncStudentSectionGrants(tx, departmentId, personId, now);
}
