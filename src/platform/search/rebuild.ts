import type { Db } from "../../lib/db/types";
import { index, INDEXED_TYPES, isIndexed } from "./indexer";

// Building the index from scratch: after a deployment that changes what a subject says about
// itself, or after somebody restores a backup. It reads the same rows the incremental path
// does, so a rebuild and a live index agree — which is what the test checks.

export interface RebuildResult {
  indexed: number;
  skipped: number;
  byType: Record<string, number>;
}

type Loader = (db: Db, departmentId: string) => Promise<string[]>;

/** Where the ids of each indexed type come from. A type with no loader is simply not rebuilt. */
const LOADERS: Record<string, Loader> = {
  person: async (db, departmentId) =>
    (
      await db.person.findMany({
        where: { departments: { some: { departmentId, leftAt: null } } },
        select: { id: true },
      })
    ).map((r) => r.id),
  staff_profile: async (db, departmentId) =>
    (await db.staffProfile.findMany({ where: { departmentId }, select: { personId: true } })).map(
      (r) => r.personId,
    ),
  course: async (db, departmentId) =>
    (await db.course.findMany({ where: { departmentId }, select: { id: true } })).map((r) => r.id),
  course_offering: async (db, departmentId) =>
    (await db.courseOffering.findMany({ where: { departmentId }, select: { id: true } })).map(
      (r) => r.id,
    ),
  group: async (db, departmentId) =>
    (await db.group.findMany({ where: { departmentId }, select: { id: true } })).map((r) => r.id),
  task: async (db, departmentId) =>
    (await db.task.findMany({ where: { departmentId }, select: { id: true } })).map((r) => r.id),
  document: async (db, departmentId) =>
    (
      await db.document.findMany({ where: { departmentId, deletedAt: null }, select: { id: true } })
    ).map((r) => r.id),
  feature_record: async (db, departmentId) =>
    (await db.featureRecord.findMany({ where: { departmentId }, select: { id: true } })).map(
      (r) => r.id,
    ),
  campaign: async (db, departmentId) =>
    (await db.campaign.findMany({ where: { departmentId }, select: { id: true } })).map((r) => r.id),
  resource: async (db, departmentId) =>
    (await db.resource.findMany({ where: { departmentId }, select: { id: true } })).map((r) => r.id),
};

export async function rebuild(
  db: Db,
  departmentId: string,
  types: string[] = [...INDEXED_TYPES],
): Promise<RebuildResult> {
  const out: RebuildResult = { indexed: 0, skipped: 0, byType: {} };
  for (const subjectType of types) {
    if (!isIndexed(subjectType)) continue;
    const loader = LOADERS[subjectType];
    if (!loader) continue;
    const ids = await loader(db, departmentId);
    // the rows of this type are rewritten wholesale, so a subject that is gone leaves no hit
    await db.searchIndexEntry.deleteMany({
      where: { departmentId, subjectType: subjectType as never },
    });
    for (const id of ids) {
      const result = await index(db, { subjectType, subjectId: id }, departmentId);
      if (result.indexed) {
        out.indexed += 1;
        out.byType[subjectType] = (out.byType[subjectType] ?? 0) + 1;
      } else out.skipped += 1;
    }
  }
  return out;
}
