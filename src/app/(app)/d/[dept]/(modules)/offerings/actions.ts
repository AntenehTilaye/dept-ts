"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { offeringSchema, teachingSchema } from "@/platform/academic/schemas";
import { ensureOffering, ensureSectionOffering } from "@/platform/academic/offerings";
import { assignTeaching, endTeaching } from "@/platform/academic/teaching";
import { enrollSectionMembers } from "@/platform/academic/enrollment";

const PERMISSION = { permission: "academic.manage" };

export const createOfferingAction = safeAction(
  offeringSchema,
  async ({ input, ctx, db }) => {
    const offering = await ensureOffering(db, ctx.departmentId, input);
    revalidatePath(`/d/${ctx.deptSlug}/offerings`);
    return { id: offering.id };
  },
  PERMISSION,
);

export const addSectionOfferingAction = safeAction(
  z.object({
    courseOfferingId: z.string().min(1),
    sectionId: z.string().min(1),
    enroll: z.string().optional(),
  }),
  async ({ input, ctx, db }) => {
    const so = await ensureSectionOffering(db, ctx.departmentId, input);
    let enrolled = 0;
    if (input.enroll === "1") enrolled = await enrollSectionMembers(db, ctx.departmentId, so.id);
    revalidatePath(`/d/${ctx.deptSlug}/offerings/${input.courseOfferingId}`);
    return { id: so.id, enrolled };
  },
  PERMISSION,
);

export const assignTeachingAction = safeAction(
  teachingSchema.extend({ courseOfferingId: z.string().min(1) }),
  async ({ input, ctx, db }) => {
    const ta = await assignTeaching(db, ctx.departmentId, input);
    revalidatePath(`/d/${ctx.deptSlug}/offerings/${input.courseOfferingId}`);
    return { id: ta.id };
  },
  PERMISSION,
);

export const endTeachingAction = safeAction(
  z.object({ teachingAssignmentId: z.string().min(1), courseOfferingId: z.string().min(1) }),
  async ({ input, ctx, db }) => {
    await endTeaching(db, ctx.departmentId, input.teachingAssignmentId);
    revalidatePath(`/d/${ctx.deptSlug}/offerings/${input.courseOfferingId}`);
    return { id: input.teachingAssignmentId };
  },
  PERMISSION,
);

export const enrollMembersAction = safeAction(
  z.object({ sectionOfferingId: z.string().min(1), courseOfferingId: z.string().min(1) }),
  async ({ input, ctx, db }) => {
    const n = await enrollSectionMembers(db, ctx.departmentId, input.sectionOfferingId);
    revalidatePath(`/d/${ctx.deptSlug}/offerings/${input.courseOfferingId}`);
    return { enrolled: n };
  },
  PERMISSION,
);

export async function createOfferingForm(fd: FormData) {
  return createOfferingAction(formToObject(fd));
}
export async function addSectionOfferingForm(fd: FormData) {
  return addSectionOfferingAction(formToObject(fd));
}
export async function assignTeachingForm(fd: FormData) {
  return assignTeachingAction(formToObject(fd));
}
export async function endTeachingForm(fd: FormData) {
  return endTeachingAction(formToObject(fd));
}
export async function enrollMembersForm(fd: FormData) {
  return enrollMembersAction(formToObject(fd));
}
