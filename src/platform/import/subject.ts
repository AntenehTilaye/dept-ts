import { register } from "../subject-registry";

// An import batch is addressed like anything else: its documents (the file it came from), its
// audit rows and its notifications all hang off this registration.

export function registerImportSubjects(): void {
  register("import_batch", {
    label: async (db, id) => {
      const batch = await db.importBatch.findUnique({ where: { id } });
      return batch ? `${batch.kind} import` : null;
    },
    snapshot: async (db, id) => {
      const batch = await db.importBatch.findUnique({ where: { id } });
      if (!batch) return null;
      return {
        label: `${batch.kind} import`,
        status: batch.committedAt ? "committed" : "open",
        departmentId: batch.departmentId,
        data: { kind: batch.kind, summary: batch.summaryJson },
      };
    },
    contextOf: async (db, id) => {
      const batch = await db.importBatch.findUnique({ where: { id } });
      if (!batch) return null;
      return {
        departmentId: batch.departmentId,
        ...(batch.contextType && batch.contextId
          ? { parentRef: { subjectType: batch.contextType, subjectId: batch.contextId } }
          : {}),
      };
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const batch = await db.importBatch.findUnique({ where: { id } });
      if (!batch) return [];
      const uploader = await db.person.findFirst({
        where: { userId: batch.uploadedBy },
        select: { id: true },
      });
      return uploader?.id === personId ? ["owner", "creator"] : [];
    },
    variables: async (db, id) => {
      const batch = await db.importBatch.findUnique({ where: { id } });
      return batch ? { import_kind: batch.kind } : {};
    },
  });
}
