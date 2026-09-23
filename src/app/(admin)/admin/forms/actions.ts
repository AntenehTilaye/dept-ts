"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { withTenantBypass } from "@/lib/db/tenant";
import { FieldDef } from "@/platform/forms/field-schema";
import { defineForm, newVersion, publishForm } from "@/platform/forms/definitions";

// Administration of faculty forms. Questions are edited as JSON here: the visual question
// builder arrives with the feature wizard, which reuses the same FieldDef contract.

const FieldsJson = z.string().transform((raw, ctx) => {
  try {
    const parsed = JSON.parse(raw);
    return z.array(FieldDef).parse(parsed);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message.slice(0, 300) : "invalid JSON",
    });
    return z.NEVER;
  }
});

export const createFormAction = adminAction(
  z.object({
    key: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[a-z][a-z0-9_]*$/, "lower_snake_case"),
    kind: z.string().min(1),
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(1000).optional(),
    fields: FieldsJson,
  }),
  async ({ input, ctx }) => {
    const form = await withTenantBypass(
      { isAdmin: true, user: { id: ctx.user.id } },
      `create form ${input.key}`,
      (tx) =>
        defineForm(tx, {
          key: input.key,
          kind: input.kind as never,
          title: input.title,
          description: input.description ?? null,
          fields: input.fields,
          createdBy: ctx.user.id,
          departmentId: null,
          publish: true,
        }),
    );
    revalidatePath("/admin/forms");
    return { id: form.id, version: form.version };
  },
);

export async function createFormForm(fd: FormData) {
  return createFormAction(formToObject(fd));
}

export const newFormVersionAction = adminAction(
  z.object({
    key: z.string().min(1),
    // empty means the faculty-wide form; a department override keeps its own version line
    departmentId: z.string().trim().optional(),
    title: z.string().trim().min(2).max(200).optional(),
    fields: FieldsJson,
    publish: z.string().optional(),
  }),
  async ({ input, ctx }) => {
    const form = await withTenantBypass(
      { isAdmin: true, user: { id: ctx.user.id } },
      `new version of form ${input.key}`,
      (tx) =>
        newVersion(tx, input.key, input.fields, {
          departmentId: input.departmentId || null,
          title: input.title,
          createdBy: ctx.user.id,
          publish: input.publish === "1",
        }),
    );
    revalidatePath(`/admin/forms/${form.id}`);
    revalidatePath("/admin/forms");
    return { id: form.id, version: form.version, status: form.status };
  },
);

export async function newFormVersionForm(fd: FormData) {
  return newFormVersionAction(formToObject(fd));
}

export const publishFormAction = adminAction(
  z.object({ formId: z.string().min(1) }),
  async ({ input, ctx }) => {
    const form = await withTenantBypass(
      { isAdmin: true, user: { id: ctx.user.id } },
      `publish form ${input.formId}`,
      (tx) => publishForm(tx, input.formId),
    );
    revalidatePath(`/admin/forms/${form.id}`);
    revalidatePath("/admin/forms");
    return { version: form.version };
  },
);

export async function publishFormForm(fd: FormData) {
  return publishFormAction(formToObject(fd));
}
