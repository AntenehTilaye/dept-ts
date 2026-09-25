import type { Relationship } from "../identity/levels";
import { register } from "../subject-registry";

// SubjectRegistry registrations for the academic registry.

const openNow = (now: Date) => ({
  validFrom: { lte: now },
  OR: [{ validTo: null }, { validTo: { gt: now } }],
});

export function registerAcademicSubjects(): void {
  register("academic_year", {
    label: async (db, id) => (await db.academicYear.findUnique({ where: { id } }))?.code ?? null,
    snapshot: async (db, id) => {
      const y = await db.academicYear.findUnique({ where: { id } });
      return y ? { label: y.code, status: y.status, departmentId: y.departmentId } : null;
    },
    contextOf: async (db, id) => {
      const y = await db.academicYear.findUnique({ where: { id } });
      return y ? { departmentId: y.departmentId } : null;
    },
    relationships: async () => [],
    url: (_id, slug) => `/d/${slug}/calendar`,
  });

  register("term", {
    label: async (db, id) => {
      const t = await db.term.findUnique({ where: { id }, include: { academicYear: true } });
      return t ? `${t.name} ${t.academicYear.code}` : null;
    },
    snapshot: async (db, id) => {
      const t = await db.term.findUnique({ where: { id }, include: { academicYear: true } });
      return t
        ? {
            label: `${t.name} ${t.academicYear.code}`,
            status: t.status,
            departmentId: t.departmentId,
          }
        : null;
    },
    contextOf: async (db, id) => {
      const t = await db.term.findUnique({ where: { id } });
      return t ? { departmentId: t.departmentId, termId: t.id } : null;
    },
    relationships: async () => [],
    variables: async (db, id) => {
      const t = await db.term.findUnique({ where: { id }, include: { academicYear: true } });
      return t ? { term_name: t.name, academic_year: t.academicYear.code } : {};
    },
    url: (_id, slug) => `/d/${slug}/calendar`,
  });

  register("calendar_period", {
    label: async (db, id) => (await db.calendarPeriod.findUnique({ where: { id } }))?.label ?? null,
    snapshot: async (db, id) => {
      const p = await db.calendarPeriod.findUnique({ where: { id } });
      return p
        ? {
            label: p.label,
            departmentId: p.departmentId,
            data: { kind: p.kind, startAt: p.startAt, endAt: p.endAt },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const p = await db.calendarPeriod.findUnique({ where: { id } });
      return p
        ? {
            departmentId: p.departmentId,
            termId: p.termId,
            parentRef: { subjectType: "term", subjectId: p.termId },
          }
        : null;
    },
    relationships: async () => [],
  });

  register("course", {
    indexDoc: async (db, id) => {
      const course = await db.course.findUnique({ where: { id } });
      return course
        ? {
            title: `${course.code} ${course.title}`,
            body: `${course.creditHours} credit hours`,
            keywords: [course.code, course.courseType, course.status],
          }
        : null;
    },
    label: async (db, id) => {
      const c = await db.course.findUnique({ where: { id } });
      return c ? `${c.code} ${c.title}` : null;
    },
    snapshot: async (db, id) => {
      const c = await db.course.findUnique({ where: { id } });
      return c
        ? { label: `${c.code} ${c.title}`, status: c.status, departmentId: c.departmentId }
        : null;
    },
    contextOf: async (db, id) => {
      const c = await db.course.findUnique({ where: { id } });
      return c
        ? { departmentId: c.departmentId, ...(c.programId ? { programId: c.programId } : {}) }
        : null;
    },
    relationships: async () => [],
    variables: async (db, id) => {
      const c = await db.course.findUnique({ where: { id } });
      return c ? { course_code: c.code, course_name: c.title } : {};
    },
    url: (_id, slug) => `/d/${slug}/courses`,
  });

  register("course_offering", {
    indexDoc: async (db, id) => {
      const offering = await db.courseOffering.findUnique({
        where: { id },
        include: { course: { select: { code: true, title: true } }, term: { select: { name: true } } },
      });
      return offering
        ? {
            title: `${offering.course.code} ${offering.course.title}`,
            body: offering.term.name,
            keywords: [offering.course.code],
          }
        : null;
    },
    label: async (db, id) => {
      const o = await db.courseOffering.findUnique({
        where: { id },
        include: { course: true, term: true },
      });
      return o ? `${o.course.code} (${o.term.name})` : null;
    },
    snapshot: async (db, id) => {
      const o = await db.courseOffering.findUnique({
        where: { id },
        include: { course: true, term: true },
      });
      return o
        ? {
            label: `${o.course.code} (${o.term.name})`,
            departmentId: o.departmentId,
            data: { termId: o.termId },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const o = await db.courseOffering.findUnique({ where: { id } });
      return o
        ? {
            departmentId: o.departmentId,
            termId: o.termId,
            ...(o.coordinatorPersonId ? { ownerPersonId: o.coordinatorPersonId } : {}),
            ...(o.featureRecordId ? { featureRecordId: o.featureRecordId } : {}),
          }
        : null;
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const o = await db.courseOffering.findUnique({ where: { id } });
      if (!o) return [];
      const rels: Relationship[] = [];
      if (o.coordinatorPersonId === personId) rels.push("owner");
      const teaching = await db.teachingAssignment.findFirst({
        where: { personId, sectionOffering: { courseOfferingId: id }, ...openNow(new Date()) },
      });
      if (teaching) rels.push("assignee");
      return rels;
    },
    variables: async (db, id) => {
      const o = await db.courseOffering.findUnique({
        where: { id },
        include: { course: true, term: { include: { academicYear: true } } },
      });
      return o
        ? {
            course_code: o.course.code,
            course_name: o.course.title,
            term_name: o.term.name,
            academic_year: o.term.academicYear.code,
          }
        : {};
    },
    url: (id, slug) => `/d/${slug}/offerings/${id}`,
  });
  registerSectionSubjects();
}

function registerSectionSubjects(): void {
  register("section_offering", {
    label: async (db, id) => {
      const s = await db.sectionOffering.findUnique({
        where: { id },
        include: { courseOffering: { include: { course: true } } },
      });
      return s ? `${s.courseOffering.course.code} ${s.sectionCode}` : null;
    },
    snapshot: async (db, id) => {
      const s = await db.sectionOffering.findUnique({
        where: { id },
        include: { courseOffering: { include: { course: true } } },
      });
      return s
        ? {
            label: `${s.courseOffering.course.code} ${s.sectionCode}`,
            departmentId: s.departmentId,
            data: { locked: !!s.assessmentLockedAt },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const s = await db.sectionOffering.findUnique({ where: { id } });
      return s
        ? {
            departmentId: s.departmentId,
            sectionOfferingId: s.id,
            sectionId: s.sectionId,
            parentRef: { subjectType: "course_offering", subjectId: s.courseOfferingId },
          }
        : null;
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const rels: Relationship[] = [];
      const now = new Date();
      if (
        await db.teachingAssignment.findFirst({
          where: { sectionOfferingId: id, personId, ...openNow(now) },
        })
      )
        rels.push("assignee");
      const so = await db.sectionOffering.findUnique({ where: { id } });
      if (
        so &&
        (await db.sectionRepresentative.findFirst({
          where: { sectionId: so.sectionId, studentId: personId, ...openNow(now) },
        }))
      )
        rels.push("section_rep");
      if (
        await db.enrollment.findFirst({
          where: {
            sectionOfferingId: id,
            studentId: personId,
            status: { in: ["enrolled", "added"] },
          },
        })
      )
        rels.push("participant");
      return rels;
    },
    url: (id, slug) => `/d/${slug}/offerings/${id}`,
  });

  register("teaching_assignment", {
    label: async (db, id) => {
      const t = await db.teachingAssignment.findUnique({
        where: { id },
        include: {
          person: true,
          sectionOffering: { include: { courseOffering: { include: { course: true } } } },
        },
      });
      return t
        ? `${t.person.fullName}: ${t.sectionOffering.courseOffering.course.code} ${t.sectionOffering.sectionCode} (${t.role})`
        : null;
    },
    snapshot: async (db, id) => {
      const t = await db.teachingAssignment.findUnique({
        where: { id },
        include: { person: true },
      });
      return t
        ? {
            label: `${t.person.fullName} (${t.role})`,
            departmentId: t.departmentId,
            data: { validTo: t.validTo },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const t = await db.teachingAssignment.findUnique({ where: { id } });
      return t
        ? {
            departmentId: t.departmentId,
            ownerPersonId: t.personId,
            sectionOfferingId: t.sectionOfferingId,
            parentRef: { subjectType: "section_offering", subjectId: t.sectionOfferingId },
          }
        : null;
    },
    relationships: async (db, id, personId) => {
      const t = await db.teachingAssignment.findUnique({ where: { id } });
      return t && personId === t.personId ? ["owner", "assignee"] : [];
    },
  });

  register("enrollment", {
    label: async (db, id) => {
      const e = await db.enrollment.findUnique({
        where: { id },
        include: { student: { include: { person: true } } },
      });
      return e ? `${e.student.person.fullName} (${e.status})` : null;
    },
    snapshot: async (db, id) => {
      const e = await db.enrollment.findUnique({ where: { id } });
      return e ? { label: e.status, status: e.status, departmentId: e.departmentId } : null;
    },
    contextOf: async (db, id) => {
      const e = await db.enrollment.findUnique({ where: { id } });
      return e
        ? {
            departmentId: e.departmentId,
            ownerPersonId: e.studentId,
            sectionOfferingId: e.sectionOfferingId,
            parentRef: { subjectType: "section_offering", subjectId: e.sectionOfferingId },
          }
        : null;
    },
    relationships: async (db, id, personId) => {
      const e = await db.enrollment.findUnique({ where: { id } });
      return e && personId === e.studentId ? ["owner"] : [];
    },
  });

  register("resource", {
    indexDoc: async (db, id) => {
      const resource = await db.resource.findUnique({ where: { id } });
      return resource
        ? {
            title: `${resource.code} ${resource.name}`,
            body: [resource.building, resource.location].filter(Boolean).join(" "),
            keywords: [resource.code, resource.kind],
          }
        : null;
    },
    label: async (db, id) => {
      const r = await db.resource.findUnique({ where: { id } });
      return r ? `${r.code} ${r.name}` : null;
    },
    snapshot: async (db, id) => {
      const r = await db.resource.findUnique({ where: { id } });
      return r
        ? {
            label: `${r.code} ${r.name}`,
            status: r.status,
            departmentId: r.departmentId,
            data: { kind: r.kind },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const r = await db.resource.findUnique({ where: { id } });
      return r
        ? {
            departmentId: r.departmentId,
            ...(r.responsiblePersonId ? { ownerPersonId: r.responsiblePersonId } : {}),
          }
        : null;
    },
    relationships: async (db, id, personId) => {
      const r = await db.resource.findUnique({ where: { id } });
      return r && personId && personId === r.responsiblePersonId ? ["owner"] : [];
    },
    variables: async (db, id) => {
      const r = await db.resource.findUnique({ where: { id } });
      return r
        ? { resource_code: r.code, resource_name: r.name, resource_location: r.location ?? "" }
        : {};
    },
    url: (_id, slug) => `/d/${slug}/resources`,
  });
}
