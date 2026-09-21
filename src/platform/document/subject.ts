import type { Db } from "../../lib/db/types";
import { register, registerDeletionCascade } from "../subject-registry";

// SubjectRegistry registration of documents and the cascade that unlinks documents when a
// subject they were attached to disappears.

export function registerDocumentSubjects(): void {
  register("document", {
    label: async (db, id) => (await db.document.findUnique({ where: { id } }))?.title ?? null,
    snapshot: async (db, id) => {
      const d = await db.document.findUnique({ where: { id } });
      return d && !d.deletedAt
        ? {
            label: d.title,
            departmentId: d.departmentId,
            data: { category: d.category, currentVersionNo: d.currentVersionNo },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const d = await db.document.findUnique({
        where: { id },
        include: { links: { orderBy: { createdAt: "asc" }, take: 1 } },
      });
      if (!d) return null;
      const first = d.links[0];
      return {
        departmentId: d.departmentId,
        ...(first
          ? { parentRef: { subjectType: first.subjectType, subjectId: first.subjectId } }
          : {}),
      };
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const d = await db.document.findUnique({ where: { id }, select: { createdBy: true } });
      if (!d) return [];
      const person = await db.person.findUnique({
        where: { id: personId },
        select: { userId: true },
      });
      return person?.userId && person.userId === d.createdBy ? ["owner", "creator"] : [];
    },
    indexDoc: async (db, id) => {
      const d = await db.document.findUnique({
        where: { id },
        include: { versions: { orderBy: { versionNo: "desc" }, take: 1 } },
      });
      return d && !d.deletedAt
        ? { title: d.title, body: d.versions[0]?.extractedText ?? "", keywords: d.tags }
        : null;
    },
    url: (id, slug) => `/d/${slug}/documents?doc=${id}`,
  });

  registerDeletionCascade("document.unlink", async (db: Db, ref) => {
    await db.documentLink.deleteMany({
      where: { subjectType: ref.subjectType as never, subjectId: ref.subjectId },
    });
  });
}
