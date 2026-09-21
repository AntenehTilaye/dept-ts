import type { LinkRole } from "@/generated/prisma/enums";
import type { Db } from "../../lib/db/types";
import { assertExists } from "../subject-registry";
import type { SubjectRef } from "../subject-registry/types";

export interface LinkSpec extends SubjectRef {
  linkRole: LinkRole;
  slotKey?: string;
}

/** Creates the links (idempotent per document/subject/role/slot) after checking the subjects exist. */
export async function createLinks(
  db: Db,
  departmentId: string,
  documentId: string,
  links: LinkSpec[],
  linkedBy: string,
) {
  for (const l of links) await assertExists(db, l);
  const rows = [];
  for (const l of links) {
    rows.push(
      await db.documentLink.upsert({
        where: {
          documentId_subjectType_subjectId_linkRole_slotKey: {
            documentId,
            subjectType: l.subjectType as never,
            subjectId: l.subjectId,
            linkRole: l.linkRole,
            slotKey: l.slotKey ?? "",
          },
        },
        create: {
          departmentId,
          documentId,
          subjectType: l.subjectType as never,
          subjectId: l.subjectId,
          linkRole: l.linkRole,
          slotKey: l.slotKey ?? "",
          linkedBy,
        },
        update: {},
      }),
    );
  }
  return rows;
}

export async function removeLink(db: Db, linkId: string): Promise<void> {
  await db.documentLink.delete({ where: { id: linkId } });
}

export async function linksOf(db: Db, documentId: string) {
  return db.documentLink.findMany({ where: { documentId }, orderBy: { createdAt: "asc" } });
}

export interface SlotStatus {
  slotKey: string;
  satisfied: boolean;
  documentId?: string;
  versionNo?: number;
}

/** Which expected deliverable slots of a subject hold a (non-deleted) document. */
export async function slotStatus(
  db: Db,
  ref: SubjectRef,
  expectedSlots: string[],
  linkRole: LinkRole = "deliverable",
): Promise<SlotStatus[]> {
  const links = await db.documentLink.findMany({
    where: {
      subjectType: ref.subjectType as never,
      subjectId: ref.subjectId,
      linkRole,
      slotKey: { in: expectedSlots },
      document: { deletedAt: null, currentVersionNo: { gt: 0 } },
    },
    include: { document: { select: { id: true, currentVersionNo: true } } },
    orderBy: { createdAt: "desc" },
  });
  return expectedSlots.map((slotKey) => {
    const hit = links.find((l) => l.slotKey === slotKey);
    return hit
      ? {
          slotKey,
          satisfied: true,
          documentId: hit.document.id,
          versionNo: hit.document.currentVersionNo,
        }
      : { slotKey, satisfied: false };
  });
}
