import type { Db } from "../../lib/db/types";
import type { Interval } from "./schema";

// How loaded somebody already is. The ledger answers it directly: hours per kind of block in a
// term, which is what "balance the duties" needs and what a head looks at before adding more.

export interface Workload {
  personId: string;
  hoursByKind: Record<string, number>;
  totalHours: number;
  blocks: number;
}

export async function workload(
  tx: Db,
  departmentId: string,
  personId: string,
  termId: string,
): Promise<Workload> {
  const term = await tx.term.findUniqueOrThrow({ where: { id: termId } });
  return workloadIn(tx, departmentId, personId, { from: term.startDate, to: term.endDate });
}

export async function workloadIn(
  tx: Db,
  departmentId: string,
  personId: string,
  range: Interval,
): Promise<Workload> {
  const blocks = await tx.availabilityBlock.findMany({
    where: {
      departmentId,
      ownerType: "person",
      ownerId: personId,
      weekday: null,
      startAt: { lt: range.to },
      endAt: { gt: range.from },
    },
    select: { kind: true, startAt: true, endAt: true },
  });

  const hoursByKind: Record<string, number> = {};
  let totalHours = 0;
  for (const block of blocks) {
    const from = block.startAt < range.from ? range.from : block.startAt;
    const to = block.endAt > range.to ? range.to : block.endAt;
    const hours = Math.max(0, (to.getTime() - from.getTime()) / 3_600_000);
    hoursByKind[block.kind] = round((hoursByKind[block.kind] ?? 0) + hours);
    totalHours = round(totalHours + hours);
  }
  return { personId, hoursByKind, totalHours, blocks: blocks.length };
}

function round(hours: number): number {
  return Math.round(hours * 100) / 100;
}
