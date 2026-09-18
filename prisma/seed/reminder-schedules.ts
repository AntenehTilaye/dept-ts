import type { PrismaClient } from "../../src/generated/prisma/client";

// Kernel reminder schedules (faculty defaults, NULL departmentId). Module phases add theirs.
const both = ["in_app", "email"];
const rem = (offsetDays: number, channels: string[] = both) => ({
  offsetDays,
  templateKey: offsetDays > 0 ? "deadline_overdue" : "deadline_reminder",
  channels,
});

export const SEED_SCHEDULES = [
  {
    key: "default_7_3_1_0_overdue",
    isDefault: true,
    offsets: [-7, -3, -1, 0, 1].map((d) => rem(d)),
    escalation: { afterOverdueDays: 3, toRoleKey: "department_head" },
  },
  {
    key: "short",
    isDefault: false,
    offsets: [-1, 0].map((d) => rem(d, ["in_app"])),
    escalation: null,
  },
  {
    key: "portfolio_7_3_1_0_overdue",
    isDefault: false,
    offsets: [-7, -3, -1, 0, 2].map((d) => rem(d)),
    escalation: { afterOverdueDays: 5, toRoleKey: "department_head" },
  },
  { key: "appointment_-1d_-2h", isDefault: false, offsets: [rem(-1)], escalation: null },
  { key: "meeting_-1d_-1h", isDefault: false, offsets: [rem(-1)], escalation: null },
  { key: "duty_-1d", isDefault: false, offsets: [rem(-1)], escalation: null },
];

export async function seedReminderSchedules(db: PrismaClient) {
  for (const s of SEED_SCHEDULES) {
    const existing = await db.reminderSchedule.findFirst({
      where: { departmentId: null, key: s.key },
    });
    const data = {
      offsetsJson: s.offsets as never,
      escalationJson: (s.escalation ?? undefined) as never,
      isDefault: s.isDefault,
      isSystem: true,
    };
    if (existing) await db.reminderSchedule.update({ where: { id: existing.id }, data });
    else await db.reminderSchedule.create({ data: { departmentId: null, key: s.key, ...data } });
  }
}
