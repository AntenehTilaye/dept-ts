import { fromJson, toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { resolveTermAnchor } from "../academic/calendar";
import { AudienceSpecSchema, type AudienceSpec } from "../people/audience";
import { enqueue } from "./enqueue";
import { cancelByPrefix } from "./ledger";
import {
  DeadlineSpec,
  escalationKey,
  EscalationSpec,
  HORIZON_HOURS,
  nextIntervalRun,
  occurrences,
  OffsetSpec,
  reminderKey,
  withinHorizon,
  type DeadlineSpec as DeadlineSpecT,
  type Occurrence,
} from "./offsets";

// Reminder subscriptions: a subject subscribes to a schedule against a deadline (fixed or
// calendar-anchored) or as an interval nudge. Offsets inside the 48 h horizon are materialised
// synchronously in the caller's transaction (ScheduledJob + pg-boss job on `reminder.fire`);
// the hourly `reminder.materialize` cron catches offsets entering the horizon later.

export interface SubscribeInput {
  subject: { subjectType: string; subjectId: string };
  deadline: DeadlineSpecT;
  scheduleKey: string;
  audienceSpec: AudienceSpec;
  variables?: Record<string, unknown>;
  now?: Date;
}

export async function scheduleOf(db: Db, departmentId: string, key: string) {
  const rows = await db.reminderSchedule.findMany({
    where: { key, OR: [{ departmentId }, { departmentId: null }] },
  });
  const row =
    rows.find((r) => r.departmentId === departmentId) ?? rows.find((r) => r.departmentId === null);
  if (!row) throw new Error(`Reminder schedule "${key}" is not seeded`);
  return {
    ...row,
    offsets: OffsetSpec.array().parse(row.offsetsJson),
    escalation: row.escalationJson ? EscalationSpec.parse(row.escalationJson) : null,
  };
}

export async function resolveDeadline(db: Db, spec: DeadlineSpecT): Promise<Date | null> {
  if ("at" in spec) return spec.at;
  if ("anchor" in spec) {
    return resolveTermAnchor(db, spec.anchor.termId, {
      periodKind: spec.anchor.periodKind,
      edge: spec.anchor.edge,
      offsetDays: spec.anchor.offsetDays,
    });
  }
  return null;
}

type SubRow = {
  id: string;
  departmentId: string;
  subjectType: string;
  subjectId: string;
  scheduleKey: string;
  resolvedDeadlineAt: Date | null;
};

/** All future occurrences of a deadline subscription (offsets plus the escalation). */
export async function occurrencesOf(db: Db, sub: SubRow, now: Date): Promise<Occurrence[]> {
  if (!sub.resolvedDeadlineAt) return [];
  const schedule = await scheduleOf(db, sub.departmentId, sub.scheduleKey);
  const subject = { subjectType: sub.subjectType, subjectId: sub.subjectId };
  const list = occurrences(subject, sub.scheduleKey, schedule.offsets, sub.resolvedDeadlineAt, now);
  if (schedule.escalation) {
    const runAt = new Date(
      sub.resolvedDeadlineAt.getTime() + schedule.escalation.afterOverdueDays * 86_400_000,
    );
    if (runAt.getTime() >= now.getTime()) {
      list.push({
        offsetDays: schedule.escalation.afterOverdueDays,
        runAt,
        idempotencyKey: escalationKey(subject, sub.scheduleKey),
        templateKey: "deadline_overdue",
        channels: ["in_app", "email"],
        overdue: true,
      });
    }
  }
  return list;
}

async function sendOccurrence(
  tx: Db,
  sub: SubRow,
  o: Occurrence,
  kind: "reminder" | "interval_nudge",
) {
  const data = {
    subscriptionId: sub.id,
    idempotencyKey: o.idempotencyKey,
    departmentId: sub.departmentId,
    offsetDays: o.offsetDays,
    templateKey: o.templateKey,
    channels: o.channels,
    overdue: o.overdue,
    interval: kind === "interval_nudge",
  };
  return enqueue(tx, "reminder.fire", data, {
    kind,
    idempotencyKey: o.idempotencyKey,
    singletonKey: o.idempotencyKey,
    startAfter: o.runAt,
    departmentId: sub.departmentId,
    subjectType: sub.subjectType,
    subjectId: sub.subjectId,
    payload: {
      subscriptionId: sub.id,
      offsetDays: o.offsetDays,
      templateKey: o.templateKey,
      channels: o.channels,
      runAt: o.runAt,
    },
  });
}

/** Materialises the occurrences of a subscription inside the horizon; returns the created keys. */
export async function materializeSubscription(
  tx: Db,
  subscriptionId: string,
  now = new Date(),
  horizonHours = HORIZON_HOURS,
): Promise<string[]> {
  const sub = await tx.reminderSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  if (!sub.active) return [];
  const subject = { subjectType: sub.subjectType, subjectId: sub.subjectId };
  const spec = DeadlineSpec.parse(sub.deadlineSpecJson);
  const created: string[] = [];
  if ("everyDays" in spec) {
    const runAt = nextIntervalRun(sub.createdAt, spec.everyDays, now);
    if (runAt.getTime() <= now.getTime() + horizonHours * 3_600_000) {
      const offsetDays = Math.round((runAt.getTime() - sub.createdAt.getTime()) / 86_400_000);
      const o: Occurrence = {
        offsetDays,
        runAt,
        idempotencyKey: reminderKey(subject, sub.scheduleKey, offsetDays),
        templateKey: "deadline_reminder",
        channels: ["in_app", "email"],
        overdue: false,
      };
      const r = await sendOccurrence(tx, sub, o, "interval_nudge");
      if (!r.duplicate) created.push(o.idempotencyKey);
    }
    return created;
  }
  for (const o of withinHorizon(await occurrencesOf(tx, sub, now), now, horizonHours)) {
    const r = await sendOccurrence(tx, sub, o, "reminder");
    if (!r.duplicate) created.push(o.idempotencyKey);
  }
  return created;
}

export async function subscribeReminders(tx: Db, departmentId: string, input: SubscribeInput) {
  const now = input.now ?? new Date();
  const spec = DeadlineSpec.parse(input.deadline);
  AudienceSpecSchema.parse(input.audienceSpec);
  await scheduleOf(tx, departmentId, input.scheduleKey);
  const resolved = await resolveDeadline(tx, spec);
  const existing = await tx.reminderSubscription.findFirst({
    where: {
      subjectType: input.subject.subjectType as never,
      subjectId: input.subject.subjectId,
      scheduleKey: input.scheduleKey,
      active: true,
    },
  });
  const data = {
    departmentId,
    subjectType: input.subject.subjectType as never,
    subjectId: input.subject.subjectId,
    kind: "everyDays" in spec ? ("interval" as const) : ("deadline" as const),
    deadlineSpecJson: toJson(spec),
    resolvedDeadlineAt: resolved,
    scheduleKey: input.scheduleKey,
    audienceSpecJson: toJson(input.audienceSpec),
    variablesJson: toJson(input.variables ?? {}),
  };
  const sub = existing
    ? await tx.reminderSubscription.update({ where: { id: existing.id }, data })
    : await tx.reminderSubscription.create({ data });
  if (existing)
    await cancelByPrefix(
      tx,
      `${input.subject.subjectType}:${input.subject.subjectId}:${input.scheduleKey}:`,
    );
  const materialized = await materializeSubscription(tx, sub.id, now);
  return { subscription: sub, materialized };
}

/** Cancels every reminder of a subject (optionally one schedule key). */
export async function cancelBySubject(
  tx: Db,
  subject: { subjectType: string; subjectId: string },
  scheduleKey?: string,
): Promise<number> {
  await tx.reminderSubscription.updateMany({
    where: {
      subjectType: subject.subjectType as never,
      subjectId: subject.subjectId,
      ...(scheduleKey ? { scheduleKey } : {}),
      active: true,
    },
    data: { active: false },
  });
  return cancelByPrefix(
    tx,
    `${subject.subjectType}:${subject.subjectId}:${scheduleKey ? `${scheduleKey}:` : ""}`,
  );
}

/**
 * Re-resolves calendar-anchored subscriptions after a period moved: cancels the old keys and
 * materialises the new ones. Returns the affected subscription ids.
 */
export async function rescheduleAnchored(
  tx: Db,
  departmentId: string,
  termId: string,
  periodKind: string,
  now = new Date(),
): Promise<string[]> {
  const subs = await tx.reminderSubscription.findMany({
    where: { departmentId, active: true, kind: "deadline" },
  });
  const touched: string[] = [];
  for (const sub of subs) {
    const spec = DeadlineSpec.parse(sub.deadlineSpecJson);
    if (
      !("anchor" in spec) ||
      spec.anchor.termId !== termId ||
      spec.anchor.periodKind !== periodKind
    )
      continue;
    const resolved = await resolveDeadline(tx, spec);
    if (resolved?.getTime() === sub.resolvedDeadlineAt?.getTime()) continue;
    await tx.reminderSubscription.update({
      where: { id: sub.id },
      data: { resolvedDeadlineAt: resolved },
    });
    await cancelByPrefix(tx, `${sub.subjectType}:${sub.subjectId}:${sub.scheduleKey}:`);
    await materializeSubscription(tx, sub.id, now);
    touched.push(sub.id);
  }
  return touched;
}

/** Subscriptions whose anchor points at a period (the calendar impact preview). */
export async function dependentsOfPeriod(db: Db, periodId: string) {
  const period = await db.calendarPeriod.findUnique({ where: { id: periodId } });
  if (!period) return [];
  const subs = await db.reminderSubscription.findMany({
    where: { departmentId: period.departmentId, active: true, kind: "deadline" },
  });
  return subs.filter((s) => {
    const spec = fromJson<DeadlineSpecT>(s.deadlineSpecJson);
    return (
      "anchor" in spec &&
      spec.anchor.termId === period.termId &&
      spec.anchor.periodKind === period.kind
    );
  });
}
