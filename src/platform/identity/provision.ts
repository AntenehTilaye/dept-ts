import { randomBytes, randomUUID } from "node:crypto";
import { auth } from "../../lib/auth/auth";
import { isOrgRoleKey, parseMemberRoles, type OrgRoleKey } from "../../lib/auth/access";
import { prismaRoot } from "../../lib/db/prisma";
import { syncMemberGrants } from "./derive";

// Administrator-driven account provisioning (there is no public sign-up):
//   1. create the better-auth user with a random password (idempotent by email),
//   2. mark the email verified (requireEmailVerification would otherwise lock the user out),
//   3. add or extend the department membership (Member.role is the comma-separated role list),
//   4. derive the department RoleGrants,
//   5. send the set-password mail through the password-reset flow.

export interface ProvisionInput {
  email: string;
  name: string;
  departmentId: string;
  roleKeys: OrgRoleKey[];
  /** Skip the set-password mail (seeds set passwords directly). */
  password?: string;
  sendMail?: boolean;
}

export interface ProvisionResult {
  userId: string;
  created: boolean;
  roles: OrgRoleKey[];
}

export async function provisionUser(input: ProvisionInput): Promise<ProvisionResult> {
  const email = input.email.trim().toLowerCase();
  const roles = input.roleKeys.filter(isOrgRoleKey);
  if (roles.length === 0) throw new Error("At least one membership role is required");

  let user = await prismaRoot.user.findUnique({ where: { email } });
  let created = false;
  if (!user) {
    const password = input.password ?? randomBytes(24).toString("base64url");
    const res = await auth.api.createUser({
      body: { email, name: input.name, password, role: "user" },
    });
    user = await prismaRoot.user.update({
      where: { id: res.user.id },
      data: { emailVerified: true },
    });
    created = true;
  }

  const existing = await prismaRoot.member.findFirst({
    where: { userId: user.id, organizationId: input.departmentId },
  });
  const merged = Array.from(new Set([...parseMemberRoles(existing?.role), ...roles]));
  if (existing) {
    await prismaRoot.member.update({
      where: { id: existing.id },
      data: { role: merged.join(",") },
    });
  } else {
    await prismaRoot.member.create({
      data: {
        id: randomUUID(),
        organizationId: input.departmentId,
        userId: user.id,
        role: merged.join(","),
        createdAt: new Date(),
      },
    });
  }
  await syncMemberGrants(user.id, input.departmentId);

  if (created && input.sendMail !== false && !input.password) {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/set-password" } });
  }
  return { userId: user.id, created, roles: merged };
}

/** Replaces the membership roles of a user in a department (an empty list removes the membership). */
export async function setMembershipRoles(
  userId: string,
  departmentId: string,
  roleKeys: OrgRoleKey[],
): Promise<void> {
  const existing = await prismaRoot.member.findFirst({
    where: { userId, organizationId: departmentId },
  });
  if (roleKeys.length === 0) {
    if (existing) await prismaRoot.member.delete({ where: { id: existing.id } });
  } else if (existing) {
    await prismaRoot.member.update({
      where: { id: existing.id },
      data: { role: roleKeys.join(",") },
    });
  } else {
    await prismaRoot.member.create({
      data: {
        id: randomUUID(),
        organizationId: departmentId,
        userId,
        role: roleKeys.join(","),
        createdAt: new Date(),
      },
    });
  }
  await syncMemberGrants(userId, departmentId);
}
