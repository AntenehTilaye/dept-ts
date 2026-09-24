import { z } from "zod";

// The written shapes of the ledger: what a policy declares and what a block is. Everything that
// reaches the database goes through these, because both are Json columns or enum-typed rows that
// several modules write.

const HHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time is written HH:MM on the 24-hour clock");

/** A weekly window in the department's own timezone. 1 = Monday … 7 = Sunday. */
export const Window = z
  .object({ weekday: z.number().int().min(1).max(7), from: HHMM, to: HHMM })
  .refine((w) => w.from < w.to, { message: "a window ends after it starts" });
export type Window = z.infer<typeof Window>;

/** A break inside the windows; without a weekday it applies to every day. */
export const BreakWindow = z
  .object({ weekday: z.number().int().min(1).max(7).optional(), from: HHMM, to: HHMM })
  .refine((w) => w.from < w.to, { message: "a break ends after it starts" });
export type BreakWindow = z.infer<typeof BreakWindow>;

/** Time away: a real interval, which also becomes a hard `blackout` block. */
export const Blackout = z
  .object({ fromAt: z.coerce.date(), toAt: z.coerce.date(), reason: z.string().max(200).optional() })
  .refine((b) => b.toAt > b.fromAt, { message: "a blackout ends after it starts" });
export type Blackout = z.infer<typeof Blackout>;

export const PolicyPurpose = z.enum(["appointments", "invigilation", "leave"]);
export type PolicyPurpose = z.infer<typeof PolicyPurpose>;

export const PolicyInput = z.object({
  purpose: PolicyPurpose,
  weeklyWindows: z.array(Window).default([]),
  /** How long one bookable slot is; without it the whole window is one slot. */
  slotMinutes: z.number().int().min(5).max(480).nullish(),
  /** How many bookings the purpose allows per day. */
  maxPerPeriod: z.number().int().min(1).nullish(),
  breakWindows: z.array(BreakWindow).default([]),
  blackoutPeriods: z.array(Blackout).default([]),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().nullish(),
});
export type PolicyInput = z.infer<typeof PolicyInput>;

export const OwnerType = z.enum(["person", "resource"]);
export type OwnerType = z.infer<typeof OwnerType>;

export const BlockKind = z.enum([
  "teaching",
  "lab",
  "exam",
  "invigilation",
  "meeting",
  "appointment",
  "leave",
  "blackout",
]);
export type BlockKind = z.infer<typeof BlockKind>;

export const Severity = z.enum(["hard", "soft"]);
export type Severity = z.infer<typeof Severity>;

export const WeekPattern = z.enum(["all", "odd", "even"]);
export type WeekPattern = z.infer<typeof WeekPattern>;

/** An owner of time: a person or a room. */
export const OwnerRef = z.object({ ownerType: OwnerType, ownerId: z.string().min(1) });
export type OwnerRef = z.infer<typeof OwnerRef>;

/**
 * One busy interval. A weekly repeat carries `weekday` and the window it repeats in; it is a
 * template until `materialiseRecurring` writes the concrete weeks, which is when the exclusion
 * constraint starts to see it.
 */
export const BlockInput = z
  .object({
    ownerType: OwnerType,
    ownerId: z.string().min(1),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    weekday: z.number().int().min(1).max(7).nullish(),
    weekPattern: WeekPattern.nullish(),
    recurringFrom: z.coerce.date().nullish(),
    recurringUntil: z.coerce.date().nullish(),
    kind: BlockKind,
    severity: Severity.default("hard"),
    termId: z.string().nullish(),
  })
  .refine((b) => b.endAt > b.startAt, { message: "a block ends after it starts" });
export type BlockInput = z.infer<typeof BlockInput>;

export interface Interval {
  from: Date;
  to: Date;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.from < b.to && b.from < a.to;
}
