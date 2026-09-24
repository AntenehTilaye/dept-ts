import type { Db } from "../../lib/db/types";
import { blocksFor, occurrencesOf, weeklyOccurrences, type BlockRow, type SourceRef } from "./blocks";
import { policyFor } from "./policies";
import { windowsCover } from "./free-slots";
import { overlaps, type Interval, type OwnerRef } from "./schema";

// One question asked in one place: "is this person or this room free then, and if not, why not?"
// Every schedule — classes, exams, invigilation duties, meetings, appointments — asks it before
// it writes, so the answer is the same wherever it is asked.

export type ConflictKind = "hard_overlap" | "soft_overlap" | "max_per_period" | "outside_windows";

export interface Conflict {
  ownerType: string;
  ownerId: string;
  kind: ConflictKind;
  /** The block that collides, when there is one. */
  block?: BlockRow;
  message: string;
}

export interface CheckOptions {
  /** Check the candidate against the windows and the count of this purpose's policy. */
  purpose?: "appointments" | "invigilation" | "leave";
  /** Blocks written by this source are the candidate's own and never collide with it. */
  ignoreSource?: SourceRef;
  /** Weekly repeat: the interval is a template and the conflicts are checked per occurrence. */
  recurring?: { weekday: number; weekPattern?: string; until: Date };
  now?: Date;
}

export async function checkConflicts(
  tx: Db,
  departmentId: string,
  owners: OwnerRef[],
  interval: Interval,
  opts: CheckOptions = {},
): Promise<Conflict[]> {
  const candidates: Interval[] = opts.recurring
    ? weeklyOccurrences(
        { startAt: interval.from, endAt: interval.to, weekday: opts.recurring.weekday },
        { from: interval.from, to: opts.recurring.until },
        opts.recurring.weekPattern ?? "all",
      )
    : [interval];
  if (!candidates.length) return [];

  const range = {
    from: candidates[0]!.from,
    to: candidates[candidates.length - 1]!.to,
  };
  const out: Conflict[] = [];

  for (const owner of owners) {
    const blocks = (await blocksFor(tx, departmentId, owner, range)).filter(
      (b) =>
        !(
          opts.ignoreSource &&
          b.sourceType === opts.ignoreSource.subjectType &&
          b.sourceId === opts.ignoreSource.subjectId
        ),
    );

    for (const candidate of candidates) {
      for (const block of blocks) {
        const busy = occurrencesOf(block, candidate);
        if (!busy.some((b) => overlaps(b, candidate))) continue;
        out.push({
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          kind: block.severity === "hard" ? "hard_overlap" : "soft_overlap",
          block,
          message: `${block.kind} ${block.startAt.toISOString()}–${block.endAt.toISOString()}`,
        });
      }
    }

    if (!opts.purpose || owner.ownerType !== "person") continue;
    const policy = await policyFor(tx, departmentId, owner.ownerId, opts.purpose, opts.now);
    if (!policy) continue;

    for (const candidate of candidates) {
      if (!windowsCover(policy, candidate, departmentTimezone(policy))) {
        out.push({
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          kind: "outside_windows",
          message: `outside the declared ${opts.purpose} windows`,
        });
        break;
      }
    }

    if (policy.maxPerPeriod) {
      for (const candidate of candidates) {
        const sameDay = blocks.filter(
          (b) => b.weekday == null && sameLocalDay(b.startAt, candidate.from),
        );
        if (sameDay.length >= policy.maxPerPeriod) {
          out.push({
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
            kind: "max_per_period",
            message: `already holds ${sameDay.length} of ${policy.maxPerPeriod} that day`,
          });
          break;
        }
      }
    }
  }
  return out;
}

/** True when nothing hard stands in the way. */
export function isFree(conflicts: Conflict[]): boolean {
  return !conflicts.some((c) => c.kind === "hard_overlap" || c.kind === "outside_windows");
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

/** The policy carries the department's timezone through its own department row. */
function departmentTimezone(policy: { timezone?: string }): string {
  return policy.timezone ?? "Africa/Addis_Ababa";
}
