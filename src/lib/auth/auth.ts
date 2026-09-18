import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin, organization } from "better-auth/plugins";
import { prismaRoot } from "../db/prisma";
import { ac, roles } from "./access";

// better-auth 1.7: local accounts only. Users are provisioned by administrators
// (src/platform/identity/provision.ts) and set their password through the reset flow; public
// sign-up is disabled. Organization = Department (same id). nextCookies() must stay last.
// Mail and grant-sync are wired through lazy imports so the `auth generate` CLI can load this
// file without booting the mailer.

const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const auth = betterAuth({
  appName: "DeptTS",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
  database: prismaAdapter(prismaRoot, { provider: "postgresql" }),
  rateLimit: {
    enabled: process.env.AUTH_RATE_LIMIT !== "0" && process.env.NODE_ENV === "production",
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    requireEmailVerification: true,
    minPasswordLength: 10,
    resetPasswordTokenExpiresIn: 60 * 60 * 24,
    sendResetPassword: async ({ user, url }) => {
      const { sendPasswordMail } = await import("../../platform/notification/mailer");
      // Not awaited: keeps the endpoint's timing independent of the mail transport.
      void sendPasswordMail({ to: user.email, name: user.name, url }).catch((error) =>
        console.error("[auth] password mail failed", error),
      );
    },
  },
  emailVerification: {
    sendOnSignUp: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 300 },
  },
  plugins: [
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
    organization({
      ac,
      roles,
      allowUserToCreateOrganization: false,
      creatorRole: "department_head",
      membershipLimit: 5000,
      organizationHooks: {
        afterAddMember: async ({ member }) => {
          const { syncMemberGrants } = await import("../../platform/identity/derive");
          await syncMemberGrants(member.userId, member.organizationId);
        },
        afterUpdateMemberRole: async ({ member }) => {
          const { syncMemberGrants } = await import("../../platform/identity/derive");
          await syncMemberGrants(member.userId, member.organizationId);
        },
        afterRemoveMember: async ({ member }) => {
          const { syncMemberGrants } = await import("../../platform/identity/derive");
          await syncMemberGrants(member.userId, member.organizationId);
        },
      },
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
export type Session = Auth["$Infer"]["Session"];
