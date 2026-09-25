import { register } from "../subject-registry";

// A generated report is a subject like anything else: it owns the document it produced, it has
// an audit trail, and a notification can point at it.

export function registerReportingSubjects(): void {
  register("generated_report", {
    label: async (db, id) => {
      const run = await db.generatedReport.findUnique({ where: { id } });
      return run ? `${run.reportKey} (${run.format})` : null;
    },
    snapshot: async (db, id) => {
      const run = await db.generatedReport.findUnique({ where: { id } });
      if (!run) return null;
      return {
        label: `${run.reportKey} (${run.format})`,
        status: run.status,
        departmentId: run.departmentId,
        data: { reportKey: run.reportKey, format: run.format, params: run.paramsJson },
      };
    },
    contextOf: async (db, id) => {
      const run = await db.generatedReport.findUnique({ where: { id } });
      return run ? { departmentId: run.departmentId } : null;
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const run = await db.generatedReport.findUnique({ where: { id } });
      if (!run) return [];
      const requester = await db.person.findFirst({
        where: { userId: run.requestedBy },
        select: { id: true },
      });
      return requester?.id === personId ? ["owner", "creator"] : [];
    },
    url: (_id, deptSlug) => `/d/${deptSlug}/reports`,
  });
}
