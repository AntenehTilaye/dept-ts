import type { Db } from "../../lib/db/types";
import { record as audit } from "../audit/record";
import { publish } from "../audit/outbox";
import { BlockInput, overlaps, type Interval, type OwnerRef } from "./schema";

// The ledger itself. Every block belongs to a source — the timetable slot, the duty assignment,
// the policy's blackout — and a source owns its blocks completely: writing them again replaces
// what it wrote before, so a module never has to work out which of its old rows to update.

export interface SourceRef {
  subjectType: string;
  subjectId: string;
}

export interface BlockRow {
  id: string;
  ownerType: string;
  ownerId: string;
  startAt: Date;
  endAt: Date;
  weekday: number | null;
  weekPattern: string | null;
  recurringFrom: Date | null;
  recurringUntil: Date | null;
  kind: string;
  severity: string;
  sourceType: string | null;
  sourceId: string | null;
}

/** What `registerBlocks` throws instead of letting `no_hard_overlap` surface as a 500. */
export class HardConflictError extends Error {
  constructor(
    readonly candidate: { ownerType: string; ownerId: string; startAt: Date; endAt: Date },
    readonly colliding: BlockRow[],
  ) {
    super(
      `${candidate.ownerType} ${candidate.ownerId} is already busy ${colliding
        .map((c) => `${c.kind} ${c.startAt.toISOString()}–${c.endAt.toISOString()}`)
        .join(", ")}`,
    );
    this.name = "HardConflictError";
  }
}

const SELECT = {
  id: true,
  ownerType: true,
  ownerId: true,
  startAt: true,
  endAt: true,
  weekday: true,
  weekPattern: true,
  recurringFrom: true,
  recurringUntil: true,
  kind: true,
  severity: true,
  sourceType: true,
  sourceId: true,
} as const;

/**
 * Replaces everything a source has written with the blocks it declares now, in one transaction.
 * A hard block that would overlap another source's hard block is refused with the colliding rows
 * named, before the database has to.
 */
export async function registerBlocks(
  tx: Db,
  departmentId: string,
  source: SourceRef,
  blocks: unknown[],
): Promise<BlockRow[]> {
  const parsed = blocks.map((b) => BlockInput.parse(b));
  await removeBySource(tx, source);

  for (const block of parsed) {
    if (block.severity !== "hard" || block.weekday != null) continue;
    const colliding = await hardBlocksIn(
      tx,
      departmentId,
      { ownerType: block.ownerType, ownerId: block.ownerId },
      { from: block.startAt, to: block.endAt },
      source,
    );
    if (colliding.length) throw new HardConflictError(block, colliding);
  }

  const written: BlockRow[] = [];
  for (const block of parsed) {
    written.push(
      await tx.availabilityBlock.create({
        data: {
          departmentId,
          ownerType: block.ownerType,
          ownerId: block.ownerId,
          startAt: block.startAt,
          endAt: block.endAt,
          weekday: block.weekday ?? null,
          weekPattern: block.weekPattern ?? null,
          recurringFrom: block.recurringFrom ?? null,
          recurringUntil: block.recurringUntil ?? null,
          kind: block.kind,
          severity: block.severity,
          sourceType: source.subjectType as never,
          sourceId: source.subjectId,
          termId: block.termId ?? null,
        },
        select: SELECT,
      }),
    );
  }

  if (written.length) {
    await audit(tx, {
      action: "update",
      subjectType: source.subjectType,
      subjectId: source.subjectId,
      departmentId,
      reason: `${written.length} availability block(s)`,
    });
    await publish(
      tx,
      "availability.blocks.changed",
      { subjectType: source.subjectType, subjectId: source.subjectId },
      { count: written.length },
      { departmentId },
    );
  }
  return written;
}

/** Everything a source wrote, gone. Returns how many rows were removed. */
export async function removeBySource(tx: Db, source: SourceRef): Promise<number> {
  const { count } = await tx.availabilityBlock.deleteMany({
    where: { sourceType: source.subjectType as never, sourceId: source.subjectId },
  });
  return count;
}

/** The hard blocks of one owner inside an interval, optionally ignoring one source's own rows. */
export async function hardBlocksIn(
  tx: Db,
  departmentId: string,
  owner: OwnerRef,
  interval: Interval,
  ignoreSource?: SourceRef,
): Promise<BlockRow[]> {
  return tx.availabilityBlock.findMany({
    where: {
      departmentId,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      severity: "hard",
      weekday: null,
      startAt: { lt: interval.to },
      endAt: { gt: interval.from },
      ...(ignoreSource
        ? {
            NOT: {
              sourceType: ignoreSource.subjectType as never,
              sourceId: ignoreSource.subjectId,
            },
          }
        : {}),
    },
    select: SELECT,
    orderBy: { startAt: "asc" },
  });
}

/** Every block of an owner that touches a range, weekly templates included. */
export async function blocksFor(
  tx: Db,
  departmentId: string,
  owner: OwnerRef,
  range: Interval,
): Promise<BlockRow[]> {
  return tx.availabilityBlock.findMany({
    where: {
      departmentId,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      OR: [
        { weekday: null, startAt: { lt: range.to }, endAt: { gt: range.from } },
        { weekday: { not: null } },
      ],
    },
    select: SELECT,
    orderBy: { startAt: "asc" },
  });
}

/** The blocks of a whole department in a range — what a week calendar of many owners needs. */
export async function scheduleFor(
  tx: Db,
  departmentId: string,
  owners: OwnerRef[],
  range: Interval,
): Promise<BlockRow[]> {
  if (!owners.length) return [];
  return tx.availabilityBlock.findMany({
    where: {
      departmentId,
      OR: owners.map((o) => ({ ownerType: o.ownerType, ownerId: o.ownerId })),
      startAt: { lt: range.to },
      endAt: { gt: range.from },
    },
    select: SELECT,
    orderBy: { startAt: "asc" },
  });
}

/**
 * Writes the concrete weeks of every weekly template of a term. A template says "Tuesday 09:00
 * to 11:00, odd weeks"; only the rows this produces take part in `no_hard_overlap`, so a term
 * is materialised once its timetable is settled.
 */
export async function materialiseRecurring(
  tx: Db,
  departmentId: string,
  termId: string,
): Promise<number> {
  const term = await tx.term.findUniqueOrThrow({ where: { id: termId } });
  const templates = await tx.availabilityBlock.findMany({
    where: { departmentId, termId, weekday: { not: null } },
  });
  let written = 0;

  for (const template of templates) {
    const source: SourceRef = {
      subjectType: "availability_block",
      subjectId: template.id,
    };
    await removeBySource(tx, source);
    const from = template.recurringFrom ?? term.startDate;
    const until = template.recurringUntil ?? term.endDate;
    const occurrences = weeklyOccurrences(
      { startAt: template.startAt, endAt: template.endAt, weekday: template.weekday! },
      { from, to: until },
      template.weekPattern ?? "all",
    );
    for (const occurrence of occurrences) {
      await tx.availabilityBlock.create({
        data: {
          departmentId,
          ownerType: template.ownerType,
          ownerId: template.ownerId,
          startAt: occurrence.from,
          endAt: occurrence.to,
          kind: template.kind,
          severity: template.severity,
          sourceType: source.subjectType as never,
          sourceId: source.subjectId,
          termId,
        },
      });
      written += 1;
    }
  }
  return written;
}

/**
 * The concrete intervals a weekly template covers inside a range. The template's own start and
 * end carry the time of day; the weekday and pattern say which days it lands on.
 */
export function weeklyOccurrences(
  template: { startAt: Date; endAt: Date; weekday: number },
  range: Interval,
  pattern: string,
): Interval[] {
  const minutes = (template.endAt.getTime() - template.startAt.getTime()) / 60_000;
  const out: Interval[] = [];
  const cursor = new Date(range.from);
  cursor.setUTCHours(
    template.startAt.getUTCHours(),
    template.startAt.getUTCMinutes(),
    0,
    0,
  );
  // walk to the first matching weekday (ISO: 1 = Monday … 7 = Sunday)
  while (isoWeekdayUtc(cursor) !== template.weekday) cursor.setUTCDate(cursor.getUTCDate() + 1);

  let week = 1;
  while (cursor <= range.to) {
    const matches = pattern === "all" || (pattern === "odd" ? week % 2 === 1 : week % 2 === 0);
    if (matches && cursor >= range.from) {
      const to = new Date(cursor.getTime() + minutes * 60_000);
      if (to <= range.to || cursor < range.to) out.push({ from: new Date(cursor), to });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 7);
    week += 1;
  }
  return out;
}

/**
 * The concrete intervals a block covers inside a range: itself when it is a one-off, and the
 * weeks it repeats on otherwise — never outside the window it repeats in, so last term's
 * timetable does not make anybody busy today.
 */
export function occurrencesOf(block: BlockRow, range: Interval): Interval[] {
  if (block.weekday == null) return [{ from: block.startAt, to: block.endAt }];
  const from = block.recurringFrom && block.recurringFrom > range.from ? block.recurringFrom : range.from;
  const to = block.recurringUntil && block.recurringUntil < range.to ? block.recurringUntil : range.to;
  if (to <= from) return [];
  return weeklyOccurrences(
    { startAt: block.startAt, endAt: block.endAt, weekday: block.weekday },
    { from, to },
    block.weekPattern ?? "all",
  );
}

function isoWeekdayUtc(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

export { overlaps };
