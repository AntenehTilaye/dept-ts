import { globalSingleton } from "../../lib/singleton";
import type { Db } from "../../lib/db/types";
import type { Actor } from "../identity/can";
import { EscalationTargetNotRegistered, ThreadNotFoundError } from "./errors";

// The escalation seam: a thread (or one answer of a submission) becomes a case. The target is
// registered by the feature runtime (P9: feature.createRecord('case', { parentRef })); until
// then every call fails with a typed error.

export interface CaseSpec {
  title: string;
  issue: string;
  requiredAction?: string;
  requesterPersonId?: string | null;
  sectionId?: string | null;
}

export interface EscalationOrigin {
  subjectType: "thread" | "submission" | "committee_report";
  subjectId: string;
  detail?: Record<string, unknown>;
}

export type EscalationTarget = (
  db: Db,
  actor: Actor,
  spec: CaseSpec,
  origin: EscalationOrigin,
) => Promise<{ taskId: string }>;

const holder = globalSingleton("thread-escalation", () => ({
  target: null as EscalationTarget | null,
}));

export function registerEscalationTarget(fn: EscalationTarget | null): void {
  holder.target = fn;
}

export async function escalate(db: Db, actor: Actor, threadId: string, spec: CaseSpec) {
  if (!holder.target) throw new EscalationTargetNotRegistered();
  const thread = await db.thread.findUnique({ where: { id: threadId } });
  if (!thread) throw new ThreadNotFoundError(threadId);
  const result = await holder.target(db, actor, spec, {
    subjectType: "thread",
    subjectId: threadId,
  });
  await db.thread.update({ where: { id: threadId }, data: { escalatedToTaskId: result.taskId } });
  return result;
}

export async function escalateAnswer(
  db: Db,
  actor: Actor,
  submissionId: string,
  questionKey: string,
  groupIndex: number,
  spec: CaseSpec,
) {
  if (!holder.target) throw new EscalationTargetNotRegistered();
  return holder.target(db, actor, spec, {
    subjectType: "submission",
    subjectId: submissionId,
    detail: { questionKey, groupIndex },
  });
}
