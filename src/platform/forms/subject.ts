import { register } from "../subject-registry";

// SubjectRegistry registrations for forms and submissions: a submission inherits the context
// of whatever it is about (a committee report inherits the committee).

export function registerFormSubjects(): void {
  register("form_definition", {
    label: async (db, id) => {
      const f = await db.formDefinition.findUnique({ where: { id } });
      return f ? `${f.title} (v${f.version})` : null;
    },
    snapshot: async (db, id) => {
      const f = await db.formDefinition.findUnique({ where: { id } });
      return f
        ? {
            label: f.title,
            status: f.status,
            departmentId: f.departmentId ?? undefined,
            data: { key: f.key, version: f.version, kind: f.kind },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const f = await db.formDefinition.findUnique({ where: { id } });
      return f ? { ...(f.departmentId ? { departmentId: f.departmentId } : {}) } : null;
    },
    relationships: async () => [],
    url: (id) => `/admin/forms/${id}`,
  });

  register("submission", {
    label: async (db, id) => {
      const s = await db.submission.findUnique({ where: { id }, include: { form: true } });
      return s ? `${s.form.title} response` : null;
    },
    snapshot: async (db, id) => {
      const s = await db.submission.findUnique({ where: { id }, include: { form: true } });
      return s
        ? {
            label: `${s.form.title} response`,
            status: s.status,
            departmentId: s.departmentId,
            data: { formKey: s.form.key, formVersion: s.formVersion, campaignId: s.campaignId },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const s = await db.submission.findUnique({ where: { id } });
      if (!s) return null;
      return {
        departmentId: s.departmentId,
        ...(s.respondentPersonId ? { ownerPersonId: s.respondentPersonId } : {}),
        ...(s.subjectType && s.subjectId
          ? { parentRef: { subjectType: s.subjectType, subjectId: s.subjectId } }
          : {}),
      };
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const s = await db.submission.findUnique({
        where: { id },
        select: { respondentPersonId: true },
      });
      return s?.respondentPersonId === personId ? ["owner", "creator"] : [];
    },
  });
}
