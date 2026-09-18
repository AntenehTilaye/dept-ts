import { fromJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { dbAudienceLoader, resolveAudienceIds, type AudienceSpec } from "../people/audience";

export interface UpcomingItem {
  subscriptionId: string;
  subjectType: string;
  subjectId: string;
  scheduleKey: string;
  deadlineAt: Date;
  variables: Record<string, unknown>;
}

/** Deadlines in [from, to] whose audience contains the person (or all deadlines when no person). */
export async function upcoming(
  db: Db,
  departmentId: string,
  opts: { personId?: string; from: Date; to: Date },
): Promise<UpcomingItem[]> {
  const subs = await db.reminderSubscription.findMany({
    where: { departmentId, active: true, resolvedDeadlineAt: { gte: opts.from, lte: opts.to } },
    orderBy: { resolvedDeadlineAt: "asc" },
  });
  const out: UpcomingItem[] = [];
  for (const s of subs) {
    if (opts.personId) {
      const ids = await resolveAudienceIds(
        fromJson<AudienceSpec>(s.audienceSpecJson),
        dbAudienceLoader(db, departmentId),
      );
      if (!ids.includes(opts.personId)) continue;
    }
    out.push({
      subscriptionId: s.id,
      subjectType: s.subjectType,
      subjectId: s.subjectId,
      scheduleKey: s.scheduleKey,
      deadlineAt: s.resolvedDeadlineAt!,
      variables: fromJson<Record<string, unknown>>(s.variablesJson),
    });
  }
  return out;
}
