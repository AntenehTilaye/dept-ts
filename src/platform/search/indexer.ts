import { toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { isRegistered, resolve, snapshot } from "../subject-registry";
import { tokensForSubject } from "./acl";

// Writing the index. A module becomes searchable by describing itself — `indexDoc` on its
// SubjectRegistry registration — and this turns that description into a row. Nothing here knows
// what a task or a course is.

/** Subject types that are worth finding; anything else is skipped without complaint. */
export const INDEXED_TYPES = [
  "person",
  "staff_profile",
  "course",
  "course_offering",
  "group",
  "task",
  "document",
  "feature_record",
  "campaign",
  "resource",
] as const;

export function isIndexed(subjectType: string): boolean {
  return (INDEXED_TYPES as readonly string[]).includes(subjectType);
}

export interface IndexResult {
  indexed: boolean;
  reason?: "not_indexed" | "no_document" | "gone";
}

/** Writes (or rewrites) the row for one subject. Idempotent: the same subject is one row. */
export async function index(
  db: Db,
  subject: { subjectType: string; subjectId: string },
  departmentId: string,
): Promise<IndexResult> {
  if (!isIndexed(subject.subjectType) || !isRegistered(subject.subjectType))
    return { indexed: false, reason: "not_indexed" };

  const registration = resolve(subject.subjectType);
  const doc = (await registration.indexDoc?.(db, subject.subjectId).catch(() => null)) ?? null;
  if (!doc) return { indexed: false, reason: "no_document" };

  const facets = await facetsOf(db, subject);
  const aclTokens = await tokensForSubject(db, subject, departmentId);
  const data = {
    departmentId,
    title: doc.title.slice(0, 500),
    bodyText: [doc.body, ...(doc.keywords ?? [])].filter(Boolean).join("\n").slice(0, 20_000),
    facetsJson: toJson(facets),
    aclTokens,
  };
  await db.searchIndexEntry.upsert({
    where: {
      subjectType_subjectId: {
        subjectType: subject.subjectType as never,
        subjectId: subject.subjectId,
      },
    },
    update: data,
    create: { subjectType: subject.subjectType as never, subjectId: subject.subjectId, ...data },
  });
  return { indexed: true };
}

export async function remove(
  db: Db,
  subject: { subjectType: string; subjectId: string },
): Promise<void> {
  await db.searchIndexEntry.deleteMany({
    where: { subjectType: subject.subjectType as never, subjectId: subject.subjectId },
  });
}

/** What a filter narrows by: the kind of thing, and its status when it has one. */
async function facetsOf(
  db: Db,
  subject: { subjectType: string; subjectId: string },
): Promise<Record<string, unknown>> {
  const snap = await snapshot(db, subject).catch(() => null);
  return {
    type: subject.subjectType,
    ...(snap?.status ? { status: snap.status } : {}),
  };
}
