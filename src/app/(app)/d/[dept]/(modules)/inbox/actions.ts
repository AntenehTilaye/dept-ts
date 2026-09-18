"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { acknowledge, decline, markRead } from "@/platform/scheduler/inbox";

function requirePerson(personId: string | null): string {
  if (!personId) throw new Error("Your account is not linked to a person record");
  return personId;
}

export const acknowledgeAction = safeAction(
  z.object({ id: z.string().min(1) }),
  async ({ input, ctx, db }) => {
    await acknowledge(db, requirePerson(ctx.personId), input.id);
    revalidatePath(`/d/${ctx.deptSlug}/inbox`);
    return { id: input.id };
  },
);

export const declineAction = safeAction(
  z.object({ id: z.string().min(1), reason: z.string().min(2).max(500) }),
  async ({ input, ctx, db }) => {
    await decline(db, requirePerson(ctx.personId), input.id, input.reason);
    revalidatePath(`/d/${ctx.deptSlug}/inbox`);
    return { id: input.id };
  },
);

export const markReadAction = safeAction(
  z.object({ ids: z.array(z.string().min(1)).min(1) }),
  async ({ input, ctx, db }) => {
    const n = await markRead(db, requirePerson(ctx.personId), input.ids);
    revalidatePath(`/d/${ctx.deptSlug}/inbox`);
    return { marked: n };
  },
);

export async function acknowledgeForm(fd: FormData) {
  return acknowledgeAction(formToObject(fd));
}
export async function declineForm(fd: FormData) {
  return declineAction(formToObject(fd));
}
export async function markReadForm(fd: FormData) {
  return markReadAction(formToObject(fd, { arrays: ["ids"] }));
}
