"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction } from "@/lib/actions/safe-action";
import { auth } from "@/lib/auth/auth";
import { ORG_ROLE_KEYS, type OrgRoleKey } from "@/lib/auth/access";
import { provisionUser, setMembershipRoles } from "@/platform/identity/provision";

const roleList = z.array(z.enum(ORG_ROLE_KEYS as [OrgRoleKey, ...OrgRoleKey[]]));

export const createUserAction = adminAction(
  z.object({
    email: z.string().email(),
    name: z.string().min(2).max(120),
    departmentId: z.string().min(1),
    roles: roleList.min(1, "Pick at least one role"),
  }),
  async ({ input }) => {
    const result = await provisionUser({
      email: input.email,
      name: input.name,
      departmentId: input.departmentId,
      roleKeys: input.roles,
    });
    revalidatePath("/admin/users");
    return result;
  },
);

export const setMembershipAction = adminAction(
  z.object({ userId: z.string().min(1), departmentId: z.string().min(1), roles: roleList }),
  async ({ input }) => {
    await setMembershipRoles(input.userId, input.departmentId, input.roles);
    revalidatePath("/admin/users");
    return { ok: true };
  },
);

export const setBanAction = adminAction(
  z.object({
    userId: z.string().min(1),
    banned: z.boolean(),
    reason: z.string().max(200).optional(),
  }),
  async ({ input }) => {
    const h = await headers();
    if (input.banned)
      await auth.api.banUser({
        body: { userId: input.userId, banReason: input.reason ?? "Disabled by administrator" },
        headers: h,
      });
    else await auth.api.unbanUser({ body: { userId: input.userId }, headers: h });
    revalidatePath("/admin/users");
    return { ok: true };
  },
);

/** Form-data adapters for progressive enhancement (plain <form action>). */
export async function createUserForm(formData: FormData) {
  const result = await createUserAction({
    email: formData.get("email"),
    name: formData.get("name"),
    departmentId: formData.get("departmentId"),
    roles: formData.getAll("roles"),
  });
  return result;
}

export async function setMembershipForm(formData: FormData) {
  return setMembershipAction({
    userId: formData.get("userId"),
    departmentId: formData.get("departmentId"),
    roles: formData.getAll("roles"),
  });
}

export async function setBanForm(formData: FormData) {
  return setBanAction({
    userId: formData.get("userId"),
    banned: formData.get("banned") === "1",
    reason: formData.get("reason") ?? undefined,
  });
}
