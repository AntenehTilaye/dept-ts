import { z } from "zod";

// Pure reminder arithmetic: offsets of a schedule against a deadline, idempotency keys, the
// synchronous-materialisation horizon and interval next-run computation (timezone-safe: all
// arithmetic is in UTC milliseconds).

export const OffsetSpec = z.object({
  offsetDays: z.number().int(),
  templateKey: z.string().min(1),
  channels: z.array(z.enum(["in_app", "email", "sms"])).min(1),
});
export type OffsetSpec = z.infer<typeof OffsetSpec>;

export const EscalationSpec = z.object({
  afterOverdueDays: z.number().int().min(1),
  toRoleKey: z.string().min(1),
});
export type EscalationSpec = z.infer<typeof EscalationSpec>;

export const DeadlineSpec = z.union([
  z.object({ at: z.coerce.date() }),
  z.object({
    anchor: z.object({
      periodKind: z.string(),
      edge: z.enum(["start", "end"]),
      offsetDays: z.number().int().default(0),
      termId: z.string(),
    }),
  }),
  z.object({ everyDays: z.number().int().min(1), whileInStates: z.array(z.string()).default([]) }),
]);
export type DeadlineSpec = z.infer<typeof DeadlineSpec>;

export const HORIZON_HOURS = 48;
const DAY_MS = 86_400_000;

export interface Occurrence {
  offsetDays: number;
  runAt: Date;
  idempotencyKey: string;
  templateKey: string;
  channels: OffsetSpec["channels"];
  /** true when the occurrence is after the deadline (overdue nudge); the deadline day itself is a reminder. */
  overdue: boolean;
}

export function reminderKey(
  subject: { subjectType: string; subjectId: string },
  scheduleKey: string,
  offsetDays: number,
): string {
  return `${subject.subjectType}:${subject.subjectId}:${scheduleKey}:${offsetDays}`;
}

export function escalationKey(
  subject: { subjectType: string; subjectId: string },
  scheduleKey: string,
): string {
  return `${subject.subjectType}:${subject.subjectId}:${scheduleKey}:escalation`;
}

/** Every occurrence of a schedule against a deadline (past ones excluded). */
export function occurrences(
  subject: { subjectType: string; subjectId: string },
  scheduleKey: string,
  offsets: OffsetSpec[],
  deadline: Date,
  now: Date,
): Occurrence[] {
  return offsets
    .map((o) => ({
      offsetDays: o.offsetDays,
      runAt: new Date(deadline.getTime() + o.offsetDays * DAY_MS),
      idempotencyKey: reminderKey(subject, scheduleKey, o.offsetDays),
      templateKey: o.templateKey,
      channels: o.channels,
      overdue: o.offsetDays > 0,
    }))
    .filter((o) => o.runAt.getTime() >= now.getTime())
    .sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
}

/** Occurrences inside the synchronous horizon (materialised at subscribe time). */
export function withinHorizon(
  all: Occurrence[],
  now: Date,
  horizonHours = HORIZON_HOURS,
): Occurrence[] {
  const limit = now.getTime() + horizonHours * 3_600_000;
  return all.filter((o) => o.runAt.getTime() <= limit);
}

/** Keys that change when a deadline moves: to cancel (old only) and to create (new only or moved). */
export function diffOccurrences(
  oldOnes: Occurrence[],
  newOnes: Occurrence[],
): { cancel: Occurrence[]; create: Occurrence[] } {
  const oldBy = new Map(oldOnes.map((o) => [o.idempotencyKey, o]));
  const newBy = new Map(newOnes.map((o) => [o.idempotencyKey, o]));
  const cancel = oldOnes.filter(
    (o) =>
      !newBy.has(o.idempotencyKey) ||
      newBy.get(o.idempotencyKey)!.runAt.getTime() !== o.runAt.getTime(),
  );
  const create = newOnes.filter(
    (o) =>
      !oldBy.has(o.idempotencyKey) ||
      oldBy.get(o.idempotencyKey)!.runAt.getTime() !== o.runAt.getTime(),
  );
  return { cancel, create };
}

/** Next run of an interval reminder: the first multiple of everyDays after `after`, from `since`. */
export function nextIntervalRun(since: Date, everyDays: number, after: Date): Date {
  const step = everyDays * DAY_MS;
  const elapsed = Math.max(0, after.getTime() - since.getTime());
  const n = Math.floor(elapsed / step) + 1;
  return new Date(since.getTime() + n * step);
}
