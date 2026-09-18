"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { activateVersion, createTemplate, newVersion } from "@/platform/template/service";

const variantsSchema = z.object({
  inApp: z.string().optional(),
  emailSubject: z.string().optional(),
  emailBody: z.string().optional(),
  sms: z.string().optional(),
  document: z.string().optional(),
  /** "name:required,name2" */
  variables: z.string().default(""),
});

function parseVariables(text: string) {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, flag] = entry.split(":");
      return { name: name!.trim(), required: flag?.trim() === "required" };
    });
}

export const newVersionAction = adminAction(
  variantsSchema.extend({ templateId: z.string().min(1), activate: z.string().optional() }),
  async ({ input, ctx }) => {
    const v = await newVersion(input.templateId, {
      variants: {
        inApp: input.inApp,
        emailSubject: input.emailSubject,
        emailBody: input.emailBody,
        sms: input.sms,
        document: input.document,
      },
      declaredVariables: parseVariables(input.variables),
      createdBy: ctx.user.id,
    });
    if (input.activate === "1") await activateVersion(input.templateId, v.version);
    revalidatePath("/admin/templates");
    return { version: v.version };
  },
);

export const activateAction = adminAction(
  z.object({ templateId: z.string().min(1), version: z.coerce.number().int().min(1) }),
  async ({ input }) => {
    await activateVersion(input.templateId, input.version);
    revalidatePath("/admin/templates");
    return { version: input.version };
  },
);

export const createTemplateAction = adminAction(
  variantsSchema.extend({
    key: z.string().regex(/^[a-z][a-z0-9_.]*$/),
    kind: z.enum(["message", "reminder", "document", "report", "export_layout"]),
    departmentId: z.string().optional(),
  }),
  async ({ input, ctx }) => {
    const t = await createTemplate({
      key: input.key,
      kind: input.kind,
      departmentId: input.departmentId || null,
      variants: {
        inApp: input.inApp,
        emailSubject: input.emailSubject,
        emailBody: input.emailBody,
        sms: input.sms,
        document: input.document,
      },
      declaredVariables: parseVariables(input.variables),
      createdBy: ctx.user.id,
    });
    revalidatePath("/admin/templates");
    return { id: t.id };
  },
);

export async function newVersionForm(fd: FormData) {
  return newVersionAction(formToObject(fd));
}
export async function activateForm(fd: FormData) {
  return activateAction(formToObject(fd));
}
export async function createTemplateForm(fd: FormData) {
  return createTemplateAction(formToObject(fd));
}
