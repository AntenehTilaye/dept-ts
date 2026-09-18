"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction } from "@/lib/actions/safe-action";
import { prismaRoot } from "@/lib/db/prisma";

const scopeSchema = z.enum(["global", "department", "program"]);

/** Upserts one SystemSetting row. The value is JSON text; invalid JSON is rejected. */
export const saveSettingAction = adminAction(
  z.object({
    key: z
      .string()
      .min(1)
      .regex(
        /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/,
        "Use dotted keys such as campaign.kThreshold",
      ),
    scope: scopeSchema,
    scopeId: z.string().default(""),
    valueJson: z.string().min(1),
  }),
  async ({ input, ctx }) => {
    let value: unknown;
    try {
      value = JSON.parse(input.valueJson);
    } catch {
      throw new Error("Value must be valid JSON (strings need quotes)");
    }
    const scopeId = input.scope === "global" ? "" : input.scopeId;
    if (input.scope !== "global" && !scopeId)
      throw new Error("A department or program id is required for this scope");
    const id = { key: input.key, scope: input.scope, scopeId };
    await prismaRoot.systemSetting.upsert({
      where: { key_scope_scopeId: id },
      update: { valueJson: value as never, updatedBy: ctx.user.id },
      create: { ...id, valueJson: value as never, updatedBy: ctx.user.id },
    });
    revalidatePath("/admin/settings");
    return id;
  },
);

export async function saveSettingForm(formData: FormData) {
  return saveSettingAction({
    key: formData.get("key"),
    scope: formData.get("scope"),
    scopeId: formData.get("scopeId") ?? "",
    valueJson: formData.get("valueJson"),
  });
}

export const deleteSettingAction = adminAction(
  z.object({ key: z.string().min(1), scope: scopeSchema, scopeId: z.string().default("") }),
  async ({ input }) => {
    await prismaRoot.systemSetting.deleteMany({ where: input });
    revalidatePath("/admin/settings");
    return input;
  },
);

export async function deleteSettingForm(formData: FormData) {
  return deleteSettingAction({
    key: formData.get("key"),
    scope: formData.get("scope"),
    scopeId: formData.get("scopeId") ?? "",
  });
}
