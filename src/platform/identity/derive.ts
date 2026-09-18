import { parseMemberRoles } from "../../lib/auth/access";
import { prismaRoot } from "../../lib/db/prisma";
import { withTenantTx, type TxClient } from "../../lib/db/tenant";

// Derived RoleGrant synchronisation. The department-membership rule lives here now; the
// registry phase adds committee membership/chair, section representative, teaching assignment,
// student section membership and lab duty, all through the same upsert/expire helpers.

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
}

/** Resolves a role key to the department override or the faculty default row id. */
export async function roleIdFor(
  tx: TxClient,
  departmentId: string,
  roleKey: string,
): Promise<string> {
  const rows = await tx.role.findMany({
    where: { key: roleKey, OR: [{ departmentId }, { departmentId: null }] },
  });
  const role =
    rows.find((r) => r.departmentId === departmentId) ?? rows.find((r) => r.departmentId === null);
  if (!role) throw new Error(`Role "${roleKey}" is not seeded`);
  return role.id;
}

/** Ensures the derived grant exists and is open; reopens an expired one. */
export async function upsertDerivedGrant(
  tx: TxClient,
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
  await tx.roleGrant.upsert({
    where: { userId_roleId_scopeType_scopeId_derivedFromId: identity },
    update: {
      validTo: null,
      validFrom: spec.validFrom ?? now,
      source: "derived",
      derivedFromType: spec.derivedFromType,
    },
    create: {
      ...identity,
      departmentId,
      source: "derived",
      derivedFromType: spec.derivedFromType,
      validFrom: spec.validFrom ?? now,
    },
  });
  return roleId;
}

/** Expires (never deletes) open derived grants of a source whose role is not in `keepRoleIds`. */
export async function expireDerivedGrants(
  tx: TxClient,
  where: { userId: string; derivedFromType: DerivedSource; derivedFromId: string },
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
  await withTenantTx(organizationId, async (tx) => {
    const keep = new Set<string>();
    for (const roleKey of roleKeys) {
      const spec: DerivedGrantSpec = {
        userId,
        roleKey,
        scopeType: "department",
        scopeId: "",
        derivedFromType: "user",
        derivedFromId: userId,
      };
      keep.add(await upsertDerivedGrant(tx, organizationId, spec, now));
    }
    await expireDerivedGrants(
      tx,
      { userId, derivedFromType: "user", derivedFromId: userId },
      keep,
      now,
    );
  });
}
