"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { programSchema } from "@/platform/academic/schemas";
import { upsertProgram } from "@/platform/academic/courses";

export const upsertProgramAction = safeAction(
  programSchema,
  async ({ input, ctx, db }) => {
    const program = await upsertProgram(db, ctx.departmentId, input);
    revalidatePath(`/d/${ctx.deptSlug}/programs`);
    return { id: program.id };
  },
  { permission: "academic.manage" },
);

export async function upsertProgramForm(fd: FormData) {
  return upsertProgramAction(formToObject(fd));
}
