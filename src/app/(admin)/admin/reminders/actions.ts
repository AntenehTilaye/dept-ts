"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { withTenantBypass } from "@/lib/db/tenant";
import { EscalationSpec, OffsetSpec } from "@/platform/scheduler/offsets";

const schema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  /** one offset per line: days:template:channels (channels joined by +) */
  offsets: z.string().min(1),
  escalationDays: z.coerce.number().int().min(1).optional(),
  escalationRole: z.string().optional(),
  isDefault: z.string().optional(),
});

function parseOffsets(text: string) {
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [days, templateKey, channels] = line.split(":");
      const parsedChannels = (channels ?? "in_app+email").split("+").map((c) => c.trim());
      return OffsetSpec.parse({
        offsetDays: Number(days),
        templateKey: templateKey?.trim() || "deadline_reminder",
        channels: parsedChannels,
      });
    });
}

/** Saves a faculty schedule. */
export const saveScheduleAction = adminAction(schema, async ({ input, ctx }) => {
  const offsets = parseOffsets(input.offsets);
  const escalation =
    input.escalationDays && input.escalationRole
      ? EscalationSpec.parse({
          afterOverdueDays: input.escalationDays,
          toRoleKey: input.escalationRole,
        })
      : null;
  await withTenantBypass(
    { isAdmin: true, user: { id: ctx.user.id } },
    `reminder schedule ${input.key}`,
    async (tx) => {
      const existing = await tx.reminderSchedule.findFirst({
        where: { departmentId: null, key: input.key },
      });
      const data = {
        offsetsJson: offsets as never,
        escalationJson: (escalation ?? undefined) as never,
        isDefault: input.isDefault === "1",
      };
      if (existing) await tx.reminderSchedule.update({ where: { id: existing.id }, data });
      else
        await tx.reminderSchedule.create({ data: { departmentId: null, key: input.key, ...data } });
    },
  );
  revalidatePath("/admin/reminders");
  return { key: input.key };
});

export async function saveScheduleForm(fd: FormData) {
  return saveScheduleAction(formToObject(fd));
}

/** Fires a real reminder for the department head(s) of a department within seconds (end-to-end check of schedule → job → template → mail). */
export const sendTestReminderAction = adminAction(
  z.object({ departmentId: z.string().min(1), scheduleKey: z.string().min(1) }),
  async ({ input }) => {
    const { withTenantTx } = await import("@/lib/db/tenant");
    const { subscribeReminders, cancelBySubject } = await import("@/platform/scheduler/reminders");
    const subject = { subjectType: "department", subjectId: input.departmentId };
    const result = await withTenantTx(input.departmentId, async (tx) => {
      await cancelBySubject(tx, subject, input.scheduleKey);
      return subscribeReminders(tx, input.departmentId, {
        subject,
        deadline: { at: new Date(Date.now() + 2_000) },
        scheduleKey: input.scheduleKey,
        audienceSpec: { roles: ["department_head"] },
        variables: { title: "Test reminder" },
      });
    });
    revalidatePath("/admin/reminders");
    return { materialized: result.materialized.length };
  },
);

export async function sendTestReminderForm(fd: FormData) {
  return sendTestReminderAction(formToObject(fd));
}
