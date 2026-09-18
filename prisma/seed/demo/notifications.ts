import type { PrismaClient } from "../../../src/generated/prisma/client";

/** Demo inbox for dh.cs: one acknowledgement-required notice and one declinable request. */
export async function seedDemoNotifications(db: PrismaClient) {
  const head = await db.person.findFirst({ where: { email: "dh.cs@deptts.local" } });
  if (!head) return;
  const rows = [
    {
      dedupeKey: "demo:policy-update:dh.cs",
      category: "announcement" as const,
      title: "Faculty assessment policy updated",
      body: "The revised assessment policy applies from Semester I. Please acknowledge that you have read it.",
      ackRequired: true,
      declinable: false,
    },
    {
      dedupeKey: "demo:invigilation-request:dh.cs",
      category: "invigilation" as const,
      title: "Invigilation duty: CS201 final, 2027-01-12 09:00",
      body: "You are scheduled to invigilate the CS201 final examination in Room 101. Decline with a reason if you are unavailable.",
      ackRequired: true,
      declinable: true,
    },
  ];
  for (const r of rows) {
    const existing = await db.notification.findUnique({ where: { dedupeKey: r.dedupeKey } });
    if (existing) continue;
    const n = await db.notification.create({
      data: { departmentId: "dep_cs", recipientPersonId: head.id, ...r },
    });
    await db.notificationDelivery.create({
      data: {
        departmentId: "dep_cs",
        notificationId: n.id,
        channel: "in_app",
        status: "sent",
        sentAt: new Date(),
      },
    });
  }
}
