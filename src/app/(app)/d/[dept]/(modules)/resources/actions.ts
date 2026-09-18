"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { resourceSchema } from "@/platform/academic/schemas";
import { upsertResource } from "@/platform/academic/resources";

export const upsertResourceAction = safeAction(
  resourceSchema.extend({ software: resourceSchema.shape.name.optional() }),
  async ({ input, ctx, db }) => {
    const softwareList = input.software
      ? input.software
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const resource = await upsertResource(db, ctx.departmentId, { ...input, softwareList });
    revalidatePath(`/d/${ctx.deptSlug}/resources`);
    return { id: resource.id };
  },
  { permission: "academic.manage" },
);

export async function upsertResourceForm(fd: FormData) {
  return upsertResourceAction(formToObject(fd));
}
