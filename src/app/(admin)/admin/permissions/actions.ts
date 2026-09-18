"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction } from "@/lib/actions/safe-action";
import { prismaRoot } from "@/lib/db/prisma";
import { withTenantBypass } from "@/lib/db/tenant";
import { invalidatePermissionKeys } from "@/platform/identity/policy-store";

const LEVELS = [
  "full",
  "manage",
  "review",
  "own",
  "assigned",
  "participate",
  "limited",
  "view",
  "submit",
  "none",
] as const;

/**
 * Saves the levels of one role for one scope. scope "faculty" edits the default rows
 * (departmentId NULL); a department id creates/updates override rows for that department.
 * A level of "inherit" removes a department override. Runs under bypass because faculty rows
 * (NULL departmentId) can only be written that way.
 */
export const saveRoleLevelsAction = adminAction(
  z.object({
    scope: z.string().min(1),
    roleKey: z.string().min(1),
    levels: z.record(z.string(), z.enum([...LEVELS, "inherit"])),
  }),
  async ({ input, ctx }) => {
    const departmentId = input.scope === "faculty" ? null : input.scope;
    const role = await prismaRoot.role.findFirst({
      where: { key: input.roleKey, departmentId: null },
    });
    if (!role) throw new Error(`Unknown role ${input.roleKey}`);
    const known = new Set(
      (await prismaRoot.permission.findMany({ select: { key: true } })).map((p) => p.key),
    );
    await withTenantBypass(
      { isAdmin: true, user: { id: ctx.user.id } },
      `permission matrix: ${input.roleKey} @ ${input.scope}`,
      async (tx) => {
        for (const [permissionKey, level] of Object.entries(input.levels)) {
          if (!known.has(permissionKey)) continue;
          const existing = await tx.rolePermission.findFirst({
            where: { departmentId, roleId: role.id, permissionKey },
          });
          if (level === "inherit") {
            if (existing && departmentId)
              await tx.rolePermission.delete({ where: { id: existing.id } });
            continue;
          }
          if (existing) {
            if (existing.level !== level)
              await tx.rolePermission.update({ where: { id: existing.id }, data: { level } });
          } else {
            await tx.rolePermission.create({
              data: { departmentId, roleId: role.id, permissionKey, level },
            });
          }
        }
      },
    );
    invalidatePermissionKeys();
    revalidatePath("/admin/permissions");
    return { saved: Object.keys(input.levels).length };
  },
);

export async function saveRoleLevelsForm(formData: FormData) {
  const levels: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith("level:") && typeof value === "string") levels[name.slice(6)] = value;
  }
  return saveRoleLevelsAction({
    scope: formData.get("scope"),
    roleKey: formData.get("roleKey"),
    levels,
  });
}

export const saveManageExclusionsAction = adminAction(
  z.object({ scope: z.string().min(1), keys: z.array(z.string()) }),
  async ({ input, ctx }) => {
    const where =
      input.scope === "faculty"
        ? {
            key_scope_scopeId: {
              key: "rbac.manageExcludedPermissions",
              scope: "global" as const,
              scopeId: "",
            },
          }
        : {
            key_scope_scopeId: {
              key: "rbac.manageExcludedPermissions",
              scope: "department" as const,
              scopeId: input.scope,
            },
          };
    await prismaRoot.systemSetting.upsert({
      where,
      update: { valueJson: input.keys, updatedBy: ctx.user.id },
      create: { ...where.key_scope_scopeId, valueJson: input.keys, updatedBy: ctx.user.id },
    });
    revalidatePath("/admin/permissions");
    return { keys: input.keys.length };
  },
);

export async function saveManageExclusionsForm(formData: FormData) {
  return saveManageExclusionsAction({
    scope: formData.get("scope"),
    keys: formData.getAll("keys").map(String),
  });
}
