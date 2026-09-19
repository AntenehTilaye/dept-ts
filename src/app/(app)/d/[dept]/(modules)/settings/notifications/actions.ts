"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { prismaRoot } from "@/lib/db/prisma";
import { NotificationCategory } from "@/generated/prisma/enums";

/**
 * Saves the user's email switches. The form submits the categories that are ON; a row is
 * stored per category that is turned off (email is on by default).
 */
export const savePreferencesAction = safeAction(
  z.object({ emailOn: z.array(z.string()).default([]) }),
  async ({ input, ctx }) => {
    const categories = Object.values(NotificationCategory);
    await prismaRoot.channelPreference.deleteMany({
      where: { userId: ctx.user.id, channel: "email" },
    });
    const off = categories.filter((c) => !input.emailOn.includes(c));
    if (off.length) {
      await prismaRoot.channelPreference.createMany({
        data: off.map((category) => ({
          userId: ctx.user.id,
          category,
          channel: "email" as const,
          enabled: false,
        })),
      });
    }
    revalidatePath(`/d/${ctx.deptSlug}/settings/notifications`);
    return { off: off.length };
  },
);

export async function savePreferencesForm(fd: FormData) {
  return savePreferencesAction(formToObject(fd, { arrays: ["emailOn"] }));
}
