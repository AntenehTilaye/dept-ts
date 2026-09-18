"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { ensurePerson, attachToDepartment, updatePerson } from "@/platform/people/persons";
import { upsertProfileItem, upsertStaffProfile } from "@/platform/people/staff";
import { upsertStudent } from "@/platform/people/students";

const personSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  type: z.enum(["staff", "student", "external"]),
  staffId: z.string().max(20).optional(),
  academicRank: z.string().max(60).optional(),
  studentNumber: z.string().max(30).optional(),
  programId: z.string().optional(),
  admissionYear: z.coerce.number().int().min(1990).max(2100).optional(),
});

/** Creates (or links) a person in this department, with a staff or student profile by type. */
export const createPersonAction = safeAction(
  personSchema,
  async ({ input, ctx, db }) => {
    const person = await ensurePerson(db, {
      fullName: input.fullName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      type: input.type,
    });
    await attachToDepartment(db, ctx.departmentId, person.id);
    if (input.type === "staff" && input.staffId) {
      await upsertStaffProfile(db, ctx.departmentId, person.id, {
        staffId: input.staffId,
        academicRank: input.academicRank ?? null,
      });
    }
    if (input.type === "student") {
      if (!input.studentNumber || !input.programId || !input.admissionYear)
        throw new Error("Student number, program and admission year are required");
      await upsertStudent(db, ctx.departmentId, person.id, {
        studentNumber: input.studentNumber,
        programId: input.programId,
        admissionYear: input.admissionYear,
      });
    }
    revalidatePath(`/d/${ctx.deptSlug}/people`);
    return { id: person.id };
  },
  { permission: "staff.manage" },
);

export const addProfileItemAction = safeAction(
  z.object({
    personId: z.string().min(1),
    kind: z.enum([
      "qualification",
      "publication",
      "research_activity",
      "training",
      "certification",
      "work_experience",
      "responsibility",
    ]),
    title: z.string().min(2).max(200),
    institutionOrVenue: z.string().max(200).optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
  }),
  async ({ input, ctx, db }) => {
    const item = await upsertProfileItem(db, ctx.departmentId, input.personId, input);
    revalidatePath(`/d/${ctx.deptSlug}/people/${input.personId}`);
    return { id: item.id };
  },
  { permission: "staff.manage" },
);

export async function createPersonForm(fd: FormData) {
  return createPersonAction(formToObject(fd));
}
export async function addProfileItemForm(fd: FormData) {
  return addProfileItemAction(formToObject(fd));
}

export const renamePersonAction = safeAction(
  z.object({
    personId: z.string().min(1),
    fullName: z.string().min(2).max(120),
    phone: z.string().max(40).optional(),
  }),
  async ({ input, ctx, db }) => {
    const link = await db.departmentPerson.findUnique({
      where: {
        departmentId_personId: { departmentId: ctx.departmentId, personId: input.personId },
      },
    });
    if (!link) throw new Error("This person is not linked to the department");
    await updatePerson(db, input.personId, {
      fullName: input.fullName,
      phone: input.phone ?? null,
    });
    revalidatePath(`/d/${ctx.deptSlug}/people/${input.personId}`);
    return { id: input.personId };
  },
  { permission: "staff.manage" },
);

export async function renamePersonForm(fd: FormData) {
  return renamePersonAction(formToObject(fd));
}
