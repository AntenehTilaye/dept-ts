import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { auth } from "./auth";
import { parseMemberRoles, type OrgRoleKey, type RoleKey } from "./access";
import { prismaRoot } from "../db/prisma";
import { withTenantTx } from "../db/tenant";
import { record } from "@/platform/audit/record";
import { can, type Actor, type SubjectRef } from "@/platform/identity/can";
import type { ActionVerb, PermissionLevelKey } from "@/platform/identity/levels";
import { dbPolicyStore } from "@/platform/identity/policy-store";

// Request-scoped authentication and authorisation helpers for layouts, pages, server actions
// and route handlers. The URL department slug is the authority for tenancy; the session's
// activeOrganizationId is only updated by explicit department selection.

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface Ctx {
  user: { id: string; email: string; name: string; role: string | null };
  isAdmin: boolean;
  activeDepartmentId: string | null;
  correlationId: string;
}

export interface DeptCtx extends Ctx {
  departmentId: string;
  deptSlug: string;
  departmentName: string;
  orgRoles: OrgRoleKey[];
  roleKeys: RoleKey[];
  personId: string | null;
}

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export const requireContext = cache(async (): Promise<Ctx> => {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  const { user } = session;
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: (user as { role?: string | null }).role ?? null,
    },
    isAdmin: (user as { role?: string | null }).role === "admin",
    activeDepartmentId:
      (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null,
    correlationId: randomUUID(),
  };
});

/** Resolves the department by URL slug and verifies membership (or global admin). */
export const requireDeptContext = cache(async (deptSlug: string): Promise<DeptCtx> => {
  const ctx = await requireContext();
  const org = await prismaRoot.organization.findUnique({
    where: { slug: deptSlug },
    include: { department: true },
  });
  if (!org?.department) throw new ForbiddenError("Unknown department");
  const member = await prismaRoot.member.findFirst({
    where: { organizationId: org.id, userId: ctx.user.id },
  });
  if (!member && !ctx.isAdmin) throw new ForbiddenError("Not a member of this department");
  const orgRoles = parseMemberRoles(member?.role);
  const grants = await dbPolicyStore.activeGrants(ctx.user.id, org.id, new Date());
  const roleKeys = new Set<RoleKey>(orgRoles);
  for (const g of grants) roleKeys.add(g.roleKey as RoleKey);
  if (ctx.isAdmin) roleKeys.add("admin");
  const person = await prismaRoot.person.findUnique({
    where: { userId: ctx.user.id },
    select: { id: true },
  });
  return {
    ...ctx,
    departmentId: org.id,
    deptSlug,
    departmentName: org.department.name,
    orgRoles,
    roleKeys: Array.from(roleKeys),
    personId: person?.id ?? null,
  };
});

export async function requireAdmin(): Promise<Ctx> {
  const ctx = await requireContext();
  if (!ctx.isAdmin) throw new ForbiddenError("Administrator only");
  return ctx;
}

export function actorOf(ctx: DeptCtx): Actor {
  return {
    userId: ctx.user.id,
    personId: ctx.personId,
    departmentId: ctx.departmentId,
    isAdmin: ctx.isAdmin,
  };
}

export interface CanResult {
  allowed: boolean;
  level: PermissionLevelKey;
  reason: string;
}

export async function canDo(
  ctx: DeptCtx,
  permissionKey: string,
  subject?: SubjectRef,
  verb?: ActionVerb,
): Promise<CanResult> {
  return can(dbPolicyStore, actorOf(ctx), permissionKey, subject, { verb });
}

/** Throws ForbiddenError (audited from the audit phase on) when the permission is missing. */
export async function requireCan(
  ctx: DeptCtx,
  permissionKey: string,
  subject?: SubjectRef,
  verb?: ActionVerb,
): Promise<CanResult> {
  const decision = await canDo(ctx, permissionKey, subject, verb);
  if (!decision.allowed) {
    await withTenantTx(ctx.departmentId, (tx) =>
      record(tx, {
        action: "denied",
        subjectType: subject?.subjectType ?? "department",
        subjectId: subject?.subjectId ?? ctx.departmentId,
        departmentId: ctx.departmentId,
        actorUserId: ctx.user.id,
        correlationId: ctx.correlationId,
        reason: `${permissionKey}: ${decision.reason}`,
      }),
    ).catch((error) => console.error("[audit] denied record failed", error));
    throw new ForbiddenError(`${permissionKey}: ${decision.reason}`);
  }
  return decision;
}
