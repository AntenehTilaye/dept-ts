import type { NotificationCategory } from "@/generated/prisma/enums";
import type { Db } from "../../lib/db/types";
import { publish } from "../audit/outbox";

// The inbox: read/acknowledge/decline are the platform's only acknowledgement mechanism
// (tasks, duties, announcements all ride on Notification rows).

export interface InboxFilter {
  unreadOnly?: boolean;
  ackRequiredOnly?: boolean;
  category?: NotificationCategory;
  limit?: number;
}

export async function inbox(db: Db, personId: string, filter: InboxFilter = {}) {
  return db.notification.findMany({
    where: {
      recipientPersonId: personId,
      ...(filter.unreadOnly ? { readAt: null } : {}),
      ...(filter.ackRequiredOnly
        ? { ackRequired: true, acknowledgedAt: null, declinedAt: null }
        : {}),
      ...(filter.category ? { category: filter.category } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 50,
  });
}

export async function unreadCount(
  db: Db,
  personId: string,
): Promise<{ unread: number; pendingAck: number }> {
  const [unread, pendingAck] = await Promise.all([
    db.notification.count({ where: { recipientPersonId: personId, readAt: null } }),
    db.notification.count({
      where: {
        recipientPersonId: personId,
        ackRequired: true,
        acknowledgedAt: null,
        declinedAt: null,
      },
    }),
  ]);
  return { unread, pendingAck };
}

export async function markRead(db: Db, personId: string, ids: string[]): Promise<number> {
  const r = await db.notification.updateMany({
    where: { id: { in: ids }, recipientPersonId: personId, readAt: null },
    data: { readAt: new Date() },
  });
  return r.count;
}

/** Acknowledges once; a second call is a no-op returning the first timestamp. */
export async function acknowledge(db: Db, personId: string, id: string) {
  const n = await db.notification.findUniqueOrThrow({ where: { id } });
  if (n.recipientPersonId !== personId) throw new Error("Not the recipient");
  if (n.acknowledgedAt) return n;
  const now = new Date();
  const updated = await db.notification.update({
    where: { id },
    data: { acknowledgedAt: now, readAt: n.readAt ?? now },
  });
  if (n.subjectType && n.subjectId) {
    await publish(
      db,
      "notification.acknowledged",
      { subjectType: n.subjectType, subjectId: n.subjectId },
      { notificationId: id, personId },
      { departmentId: n.departmentId },
    );
  }
  return updated;
}

export async function decline(db: Db, personId: string, id: string, reason: string) {
  const n = await db.notification.findUniqueOrThrow({ where: { id } });
  if (n.recipientPersonId !== personId) throw new Error("Not the recipient");
  if (!n.declinable) throw new Error("This notification cannot be declined");
  if (n.declinedAt) return n;
  const now = new Date();
  const updated = await db.notification.update({
    where: { id },
    data: { declinedAt: now, declineReason: reason.trim(), readAt: n.readAt ?? now },
  });
  await publish(
    db,
    "notification.declined",
    n.subjectType && n.subjectId
      ? { subjectType: n.subjectType, subjectId: n.subjectId }
      : { subjectType: "notification", subjectId: id },
    { notificationId: id, personId, reason: reason.trim() },
    { departmentId: n.departmentId },
  );
  return updated;
}

export interface AckStatus {
  total: number;
  acknowledged: number;
  declined: number;
  pending: number;
  perPerson: Array<{
    personId: string;
    status: "acknowledged" | "declined" | "pending";
    at: Date | null;
    reason: string | null;
  }>;
}

/** Aggregated acknowledgement state of a subject's ack-required notifications. */
export async function ackStatus(
  db: Db,
  subject: { subjectType: string; subjectId: string },
): Promise<AckStatus> {
  const rows = await db.notification.findMany({
    where: {
      subjectType: subject.subjectType as never,
      subjectId: subject.subjectId,
      ackRequired: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const perPerson = rows.map((r) => ({
    personId: r.recipientPersonId,
    status: r.acknowledgedAt
      ? ("acknowledged" as const)
      : r.declinedAt
        ? ("declined" as const)
        : ("pending" as const),
    at: r.acknowledgedAt ?? r.declinedAt,
    reason: r.declineReason,
  }));
  return {
    total: rows.length,
    acknowledged: perPerson.filter((p) => p.status === "acknowledged").length,
    declined: perPerson.filter((p) => p.status === "declined").length,
    pending: perPerson.filter((p) => p.status === "pending").length,
    perPerson,
  };
}
