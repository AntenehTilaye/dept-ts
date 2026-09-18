"use server";

import { revalidatePath } from "next/cache";
import { safeAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { courseSchema } from "@/platform/academic/schemas";
import { upsertCourse } from "@/platform/academic/courses";

export const upsertCourseAction = safeAction(
  courseSchema,
  async ({ input, ctx, db }) => {
    const course = await upsertCourse(db, ctx.departmentId, input);
    revalidatePath(`/d/${ctx.deptSlug}/courses`);
    return { id: course.id };
  },
  { permission: "academic.manage" },
);

export async function upsertCourseForm(fd: FormData) {
  return upsertCourseAction(formToObject(fd));
}
