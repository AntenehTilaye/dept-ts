import type { Db } from "../../lib/db/types";
import { checkConflicts, type CheckOptions } from "./conflicts";
import { workloadIn } from "./workload";
import type { Interval } from "./schema";

// Who should take this? Whoever is actually free, then whoever it inconveniences least, then
// whoever has had the least of it so far — the order a head would use, applied consistently.

export interface Suggestion {
  personId: string;
  free: boolean;
  softConflicts: number;
  hours: number;
  reason: string;
}

export interface SuggestOptions extends CheckOptions {
  /** Nobody from this list is suggested (already assigned, teaching the course, ...). */
  exclude?: string[];
  /** How far back the balancing looks; the term by default. */
  since?: Date;
  limit?: number;
}

export async function suggestAssignees(
  tx: Db,
  departmentId: string,
  interval: Interval,
  pool: string[],
  opts: SuggestOptions = {},
): Promise<Suggestion[]> {
  const excluded = new Set(opts.exclude ?? []);
  const since = opts.since ?? new Date(interval.from.getTime() - 120 * 86_400_000);
  const out: Suggestion[] = [];

  for (const personId of pool) {
    if (excluded.has(personId)) continue;
    const conflicts = await checkConflicts(
      tx,
      departmentId,
      [{ ownerType: "person", ownerId: personId }],
      interval,
      opts,
    );
    const hard = conflicts.filter((c) => c.kind === "hard_overlap" || c.kind === "outside_windows");
    const soft = conflicts.filter((c) => c.kind === "soft_overlap");
    const load = await workloadIn(tx, departmentId, personId, { from: since, to: interval.to });
    out.push({
      personId,
      free: hard.length === 0,
      softConflicts: soft.length,
      hours: load.totalHours,
      reason: hard.length
        ? (hard[0]!.message ?? "not free")
        : soft.length
          ? `${soft.length} soft conflict(s)`
          : `${load.totalHours}h already`,
    });
  }

  out.sort(
    (a, b) =>
      Number(b.free) - Number(a.free) ||
      a.softConflicts - b.softConflicts ||
      a.hours - b.hours ||
      a.personId.localeCompare(b.personId),
  );
  return opts.limit ? out.slice(0, opts.limit) : out;
}
