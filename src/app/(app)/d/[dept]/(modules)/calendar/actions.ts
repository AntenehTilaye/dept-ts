"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { academicYearSchema, periodSchema, termSchema } from "@/platform/academic/schemas";
import {
  createAcademicYear,
  createTerm,
  deletePeriod,
  setCurrentTerm,
  setPeriod,
} from "@/platform/academic/calendar";

const PERMISSION = { permission: "academic.manage" };

export const createYearAction = safeAction(
  academicYearSchema,
  async ({ input, ctx, db }) => {
    const year = await createAcademicYear(db, ctx.departmentId, input);
    revalidatePath(`/d/${ctx.deptSlug}/calendar`);
    return { id: year.id };
  },
  PERMISSION,
);

export const createTermAction = safeAction(
  termSchema,
  async ({ input, ctx, db }) => {
    const term = await createTerm(db, ctx.departmentId, input);
    revalidatePath(`/d/${ctx.deptSlug}/calendar`);
    return { id: term.id };
  },
  PERMISSION,
);

export const setCurrentTermAction = safeAction(
  z.object({ termId: z.string().min(1) }),
  async ({ input, ctx, db }) => {
    await setCurrentTerm(db, ctx.departmentId, input.termId);
    revalidatePath(`/d/${ctx.deptSlug}/calendar`);
    return { id: input.termId };
  },
  PERMISSION,
);

export const setPeriodAction = safeAction(
  periodSchema,
  async ({ input, ctx, db }) => {
    const { period, dependents } = await setPeriod(db, ctx.departmentId, input);
    revalidatePath(`/d/${ctx.deptSlug}/calendar`);
    return { id: period.id, dependents: dependents.length };
  },
  PERMISSION,
);

export const deletePeriodAction = safeAction(
  z.object({ periodId: z.string().min(1) }),
  async ({ input, ctx, db }) => {
    await deletePeriod(db, input.periodId);
    revalidatePath(`/d/${ctx.deptSlug}/calendar`);
    return { id: input.periodId };
  },
  PERMISSION,
);

export async function createYearForm(fd: FormData) {
  return createYearAction(formToObject(fd));
}
export async function createTermForm(fd: FormData) {
  return createTermAction(formToObject(fd));
}
export async function setCurrentTermForm(fd: FormData) {
  return setCurrentTermAction(formToObject(fd));
}
export async function setPeriodForm(fd: FormData) {
  return setPeriodAction(formToObject(fd));
}
export async function deletePeriodForm(fd: FormData) {
  return deletePeriodAction(formToObject(fd));
}
