"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { definePolicy, HardConflictError } from "@/platform/availability";

// Declaring when you are available is about your own time, so these actions act on the signed-in
// person and never take a person id from the client.

const Window = z.object({
  weekday: z.coerce.number().int().min(1).max(7),
  from: z.string(),
  to: z.string(),
});

export const savePolicyAction = safeAction(
  z.object({
    purpose: z.enum(["appointments", "invigilation", "leave"]),
    weeklyWindows: z.array(Window).default([]),
    breakWindows: z
      .array(z.object({ weekday: z.coerce.number().int().min(1).max(7).optional(), from: z.string(), to: z.string() }))
      .default([]),
    blackoutPeriods: z
      .array(z.object({ fromAt: z.string(), toAt: z.string(), reason: z.string().max(200).optional() }))
      .default([]),
    slotMinutes: z.coerce.number().int().min(5).max(480).nullish(),
    maxPerPeriod: z.coerce.number().int().min(1).nullish(),
    validFrom: z.string(),
  }),
  async ({ input, ctx, db }) => {
    if (!ctx.personId) throw new Error("Your account is not linked to a person record.");
    try {
      const policy = await definePolicy(db, ctx.departmentId, ctx.personId, input, ctx.user.id);
      revalidatePath(`/d/${ctx.deptSlug}/availability`);
      return { id: policy.id, purpose: policy.purpose };
    } catch (error) {
      // the ledger refuses a day away that sits on top of something already booked, and says
      // exactly what it collided with
      if (error instanceof HardConflictError) throw new Error(error.message);
      throw error;
    }
  },
);
