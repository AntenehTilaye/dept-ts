import type { Db } from "../../lib/db/types";

// A subject's timeline: audit rows and workflow transitions merged by time (newest first).

export interface HistoryEntry {
  id: string;
  at: Date;
  kind: "audit" | "transition";
  action: string;
  actorUserId: string | null;
  comment?: string | null;
  changes?: Record<string, { before: unknown; after: unknown }> | null;
  fromState?: string;
  toState?: string;
  branchKey?: string | null;
  correlationId?: string | null;
}

export async function history(
  db: Db,
  subject: { subjectType: string; subjectId: string },
  limit = 100,
): Promise<HistoryEntry[]> {
  const [audit, instances] = await Promise.all([
    db.auditEvent.findMany({
      where: { subjectType: subject.subjectType as never, subjectId: subject.subjectId },
      orderBy: { at: "desc" },
      take: limit,
    }),
    db.workflowInstance.findMany({
      where: { subjectType: subject.subjectType as never, subjectId: subject.subjectId },
      include: { transitions: { orderBy: { at: "desc" }, take: limit } },
    }),
  ]);
  const entries: HistoryEntry[] = audit.map((a) => ({
    id: a.id,
    at: a.at,
    kind: "audit",
    action: a.action,
    actorUserId: a.actorUserId,
    comment: a.reason,
    changes: (a.fieldChangesJson as HistoryEntry["changes"]) ?? null,
    correlationId: a.correlationId,
  }));
  for (const i of instances) {
    for (const t of i.transitions) {
      entries.push({
        id: t.id,
        at: t.at,
        kind: "transition",
        action: t.transitionKey,
        actorUserId: t.actorUserId,
        comment: t.comment,
        fromState: t.fromState,
        toState: t.toState,
        branchKey: t.branchKey,
      });
    }
  }
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
