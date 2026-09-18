"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { requireContext } from "@/lib/auth/require";
import { prismaRoot } from "@/lib/db/prisma";

/** Records the chosen department on the session and navigates to it. */
export async function selectDepartmentAction(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  const ctx = await requireContext();
  const org = await prismaRoot.organization.findUnique({ where: { slug } });
  if (!org) redirect("/select-department");
  const member = await prismaRoot.member.findFirst({
    where: { organizationId: org.id, userId: ctx.user.id },
  });
  if (!member && !ctx.isAdmin) redirect("/select-department");
  if (member) {
    await auth.api.setActiveOrganization({
      body: { organizationId: org.id },
      headers: await headers(),
    });
  } else {
    // The plugin endpoint refuses non-members; administrators get the session row updated directly.
    await prismaRoot.session.updateMany({
      where: { userId: ctx.user.id, expiresAt: { gt: new Date() } },
      data: { activeOrganizationId: org.id },
    });
  }
  redirect(`/d/${slug}`);
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
