"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { sectionSchema } from "@/platform/academic/schemas";
import { createGroup } from "@/platform/people/groups";
import { assignRepresentative, endRepresentative } from "@/platform/people/representatives";
import { setSectionMembership } from "@/platform/people/students";
import { provisionUser } from "@/platform/identity/provision";

const PERMISSION = { permission: "academic.manage" };

export const createSectionAction = safeAction(
  sectionSchema,
  async ({ input, ctx, db }) => {
    const group = await createGroup(db, ctx.departmentId, { kind: "section", name: input.code });
    const section = await db.section.create({
      data: {
        departmentId: ctx.departmentId,
        programId: input.programId,
        academicYearId: input.academicYearId,
        yearLevel: input.yearLevel,
        code: input.code.trim(),
        capacity: input.capacity ?? null,
        groupId: group.id,
      },
    });
    await db.group.update({
      where: { id: group.id },
      data: { contextType: "section", contextId: section.id },
    });
    revalidatePath(`/d/${ctx.deptSlug}/sections`);
    return { id: section.id };
  },
  PERMISSION,
);

export const addStudentToSectionAction = safeAction(
  z.object({ sectionId: z.string().min(1), studentId: z.string().min(1) }),
  async ({ input, ctx, db }) => {
    const section = await db.section.findUniqueOrThrow({ where: { id: input.sectionId } });
    const m = await setSectionMembership(db, ctx.departmentId, {
      studentId: input.studentId,
      sectionId: input.sectionId,
      academicYearId: section.academicYearId,
    });
    revalidatePath(`/d/${ctx.deptSlug}/sections`);
    return { id: m.id };
  },
  PERMISSION,
);

export const assignRepresentativeAction = safeAction(
  z.object({
    sectionId: z.string().min(1),
    studentId: z.string().min(1),
    isPrimary: z.string().optional(),
  }),
  async ({ input, ctx, db }) => {
    const section = await db.section.findUniqueOrThrow({ where: { id: input.sectionId } });
    const result = await assignRepresentative(db, ctx.departmentId, {
      sectionId: input.sectionId,
      studentId: input.studentId,
      academicYearId: section.academicYearId,
      isPrimary: input.isPrimary !== "0",
      provision: async (person) => {
        const r = await provisionUser({
          email: person.email,
          name: person.fullName,
          departmentId: ctx.departmentId,
          roleKeys: ["student_rep"],
        });
        return r.userId;
      },
    });
    revalidatePath(`/d/${ctx.deptSlug}/sections`);
    return { id: result.representative.id, invited: result.invited };
  },
  PERMISSION,
);

export const endRepresentativeAction = safeAction(
  z.object({ representativeId: z.string().min(1) }),
  async ({ input, ctx, db }) => {
    await endRepresentative(db, ctx.departmentId, input.representativeId);
    revalidatePath(`/d/${ctx.deptSlug}/sections`);
    return { id: input.representativeId };
  },
  PERMISSION,
);

export async function createSectionForm(fd: FormData) {
  return createSectionAction(formToObject(fd));
}
export async function addStudentToSectionForm(fd: FormData) {
  return addStudentToSectionAction(formToObject(fd));
}
export async function assignRepresentativeForm(fd: FormData) {
  return assignRepresentativeAction(formToObject(fd));
}
export async function endRepresentativeForm(fd: FormData) {
  return endRepresentativeAction(formToObject(fd));
}
