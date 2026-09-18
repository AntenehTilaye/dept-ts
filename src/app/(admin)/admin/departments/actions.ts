"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction } from "@/lib/actions/safe-action";
import { departmentService } from "@/platform/people/departments";

export const createDepartmentAction = adminAction(
  z.object({ code: z.string().min(2).max(12), name: z.string().min(2).max(120) }),
  async ({ input }) => {
    const dept = await departmentService.create({ code: input.code, name: input.name });
    revalidatePath("/admin/departments");
    return { id: dept.id, code: dept.code };
  },
);

export async function createDepartmentForm(formData: FormData) {
  return createDepartmentAction({ code: formData.get("code"), name: formData.get("name") });
}
