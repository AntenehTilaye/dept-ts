import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { record as audit } from "../audit/record";
import { publish } from "../audit/outbox";
import { registerBlocks } from "./blocks";
import {
  Blackout,
  BreakWindow,
  PolicyInput,
  Window,
  type PolicyPurpose,
} from "./schema";

// A policy is what somebody is willing to be booked for, and it is theirs: the windows they
// offer, the breaks they keep, the days they are away. The days away are the only part that
// reaches the ledger — everything else is a shape the free-slot and conflict queries read.

export interface ResolvedPolicy {
  id: string;
  ownerPersonId: string;
  purpose: PolicyPurpose;
  weeklyWindows: Window[];
  breakWindows: BreakWindow[];
  blackoutPeriods: Blackout[];
  slotMinutes: number | null;
  maxPerPeriod: number | null;
  validFrom: Date;
  validTo: Date | null;
  /** The department's timezone, which is what the written times mean. */
  timezone: string;
}

export async function definePolicy(
  tx: Db,
  departmentId: string,
  ownerPersonId: string,
  input: unknown,
  actorUserId?: string | null,
): Promise<ResolvedPolicy> {
  const parsed = PolicyInput.parse(input);
  const existing = await tx.availabilityPolicy.findFirst({
    where: { departmentId, ownerPersonId, purpose: parsed.purpose },
    orderBy: { validFrom: "desc" },
  });

  const data = {
    departmentId,
    ownerPersonId,
    purpose: parsed.purpose,
    weeklyWindowsJson: toJson(parsed.weeklyWindows),
    slotMinutes: parsed.slotMinutes ?? null,
    maxPerPeriod: parsed.maxPerPeriod ?? null,
    breakWindowsJson: toJson(parsed.breakWindows),
    blackoutPeriodsJson: toJson(
      parsed.blackoutPeriods.map((b) => ({
        fromAt: b.fromAt.toISOString(),
        toAt: b.toAt.toISOString(),
        ...(b.reason ? { reason: b.reason } : {}),
      })),
    ),
    validFrom: parsed.validFrom,
    validTo: parsed.validTo ?? null,
  };
  const row = existing
    ? await tx.availabilityPolicy.update({ where: { id: existing.id }, data })
    : await tx.availabilityPolicy.create({ data });

  // being away is busy time like any other, so it belongs in the ledger where every conflict
  // check already looks
  await registerBlocks(
    tx,
    departmentId,
    { subjectType: "availability_policy", subjectId: row.id },
    parsed.blackoutPeriods.map((b) => ({
      ownerType: "person" as const,
      ownerId: ownerPersonId,
      startAt: b.fromAt,
      endAt: b.toAt,
      kind: parsed.purpose === "leave" ? ("leave" as const) : ("blackout" as const),
      severity: "hard" as const,
    })),
  );

  await audit(tx, {
    action: existing ? "update" : "create",
    subjectType: "availability_policy",
    subjectId: row.id,
    departmentId,
    actorUserId: actorUserId ?? null,
    reason: parsed.purpose,
  });
  await publish(
    tx,
    "availability.policy.changed",
    { subjectType: "availability_policy", subjectId: row.id },
    { ownerPersonId, purpose: parsed.purpose },
    { departmentId },
  );

  return resolve(row, await timezoneOf(tx, departmentId));
}

/** The policy in force for a person and purpose, or null when they have declared none. */
export async function policyFor(
  tx: Db,
  departmentId: string,
  ownerPersonId: string,
  purpose: PolicyPurpose,
  asOf: Date = new Date(),
): Promise<ResolvedPolicy | null> {
  const row = await tx.availabilityPolicy.findFirst({
    where: {
      departmentId,
      ownerPersonId,
      purpose,
      validFrom: { lte: asOf },
      OR: [{ validTo: null }, { validTo: { gte: asOf } }],
    },
    orderBy: { validFrom: "desc" },
  });
  return row ? resolve(row, await timezoneOf(tx, departmentId)) : null;
}

/** Every policy a person has declared. */
export async function policiesOf(
  tx: Db,
  departmentId: string,
  ownerPersonId: string,
): Promise<ResolvedPolicy[]> {
  const rows = await tx.availabilityPolicy.findMany({
    where: { departmentId, ownerPersonId },
    orderBy: { purpose: "asc" },
  });
  const timezone = await timezoneOf(tx, departmentId);
  return rows.map((row) => resolve(row, timezone));
}

async function timezoneOf(tx: Db, departmentId: string): Promise<string> {
  const department = await tx.department.findUnique({
    where: { id: departmentId },
    select: { timezone: true },
  });
  return department?.timezone ?? "Africa/Addis_Ababa";
}

function resolve(
  row: {
    id: string;
    ownerPersonId: string;
    purpose: string;
    weeklyWindowsJson: unknown;
    breakWindowsJson: unknown;
    blackoutPeriodsJson: unknown;
    slotMinutes: number | null;
    maxPerPeriod: number | null;
    validFrom: Date;
    validTo: Date | null;
  },
  timezone: string,
): ResolvedPolicy {
  return {
    id: row.id,
    ownerPersonId: row.ownerPersonId,
    purpose: row.purpose as PolicyPurpose,
    weeklyWindows: Window.array().catch([]).parse(row.weeklyWindowsJson),
    breakWindows: BreakWindow.array().catch([]).parse(row.breakWindowsJson),
    blackoutPeriods: Blackout.array().catch([]).parse(row.blackoutPeriodsJson),
    slotMinutes: row.slotMinutes,
    maxPerPeriod: row.maxPerPeriod,
    validFrom: row.validFrom,
    validTo: row.validTo,
    timezone,
  };
}
