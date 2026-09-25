import { globalSingleton } from "../../../lib/singleton";
import type { Db } from "../../../lib/db/types";
import type { Actor } from "../../identity/can";

// What a validated file actually does to the department. A committer runs once, inside the
// commit transaction, with the rows a validator already understood — so it writes rather than
// interprets, and either the whole batch lands or none of it does.

export interface CommitContext {
  tx: Db;
  actor: Actor;
  departmentId: string;
  batchId: string;
  context?: { subjectType: string; subjectId: string } | null;
}

export interface CommitSummary {
  /** What was written, in the words of the thing being imported. */
  counts: Record<string, number>;
  message: string;
}

export type Committer = (
  ctx: CommitContext,
  rows: Record<string, unknown>[],
) => Promise<CommitSummary>;

const committers = globalSingleton("import-committers", () => new Map<string, Committer>());

export function registerCommitter(kind: string, committer: Committer): void {
  committers.set(kind, committer);
}

export function getCommitter(kind: string): Committer | undefined {
  return committers.get(kind);
}

export async function commitRows(
  kind: string,
  ctx: CommitContext,
  rows: Record<string, unknown>[],
): Promise<CommitSummary> {
  const committer = committers.get(kind);
  if (!committer) throw new Error(`No committer is registered for "${kind}" imports`);
  return committer(ctx, rows);
}
