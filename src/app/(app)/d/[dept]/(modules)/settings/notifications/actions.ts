"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { prismaRoot } from "@/lib/db/prisma";
import { NotificationCategory } from "@/generated/prisma/enums";

/** Saves the user's email switches: one row per category that is turned off (default on). */
export const savePreferencesAction = safeAction(
  z.object({ emailOff: z.array(z.string()).default([]) }),
  async ({ input, ctx }) => {
    const categories = Object.values(NotificationCategory);
    await prismaRoot.channelPreference.deleteMany({
      where: { userId: ctx.user.id, channel: "email" },
    });
    const off = input.emailOff.filter((c): c is NotificationCategory =>
      (categories as string[]).includes(c),
    );
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
  return savePreferencesAction(formToObject(fd, { arrays: ["emailOff"] }));
}
