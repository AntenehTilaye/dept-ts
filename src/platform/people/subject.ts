import type { Db } from "../../lib/db/types";
import type { Relationship } from "../identity/levels";
import { register } from "../subject-registry";

// SubjectRegistry registrations for the people services. Reads go through the caller's client.

const openNow = (now: Date) => ({
  validFrom: { lte: now },
  OR: [{ validTo: null }, { validTo: { gt: now } }],
});

async function personOf(db: Db, id: string) {
  return db.person.findUnique({
    where: { id },
    select: { id: true, fullName: true, email: true, status: true, type: true, userId: true },
  });
}

export function registerPeopleSubjects(): void {
  register("department", {
    label: async (db, id) => (await db.department.findUnique({ where: { id } }))?.name ?? null,
    snapshot: async (db, id) => {
      const d = await db.department.findUnique({ where: { id } });
      return d ? { label: d.name, departmentId: d.id, data: { code: d.code } } : null;
    },
    contextOf: async (_db, id) => ({ departmentId: id }),
    relationships: async () => [],
    url: (_id, slug) => `/d/${slug}`,
  });

  register("person", {
    indexDoc: async (db, id) => {
      const person = await db.person.findUnique({ where: { id } });
      if (!person) return null;
      const profile = await db.staffProfile.findUnique({ where: { personId: id } });
      return {
        title: person.fullName,
        body: [person.email, person.roleLabel, profile?.specialization, profile?.academicRank]
          .filter(Boolean)
          .join(" · "),
        keywords: [person.type, ...(profile?.staffId ? [profile.staffId] : [])],
      };
    },
    label: async (db, id) => (await personOf(db, id))?.fullName ?? null,
    snapshot: async (db, id) => {
      const p = await personOf(db, id);
      return p
        ? { label: p.fullName, status: p.status, data: { email: p.email, type: p.type } }
        : null;
    },
    contextOf: async (_db, id) => ({ ownerPersonId: id }),
    relationships: async (_db, id, personId) => (personId && personId === id ? ["owner"] : []),
    variables: async (db, id) => {
      const p = await personOf(db, id);
      return p ? { person_name: p.fullName, person_email: p.email ?? "" } : {};
    },
    url: (id, slug) => `/d/${slug}/people/${id}`,
  });

  register("staff_profile", {
    indexDoc: async (db, id) => {
      const profile = await db.staffProfile.findUnique({
        where: { personId: id },
        include: { person: { select: { fullName: true, email: true } } },
      });
      return profile
        ? {
            title: profile.person.fullName,
            body: [profile.academicRank, profile.specialization, profile.officeLocation]
              .filter(Boolean)
              .join(" · "),
            keywords: [profile.staffId, ...(profile.academicInterests ?? [])],
          }
        : null;
    },
    label: async (db, id) =>
      (await db.staffProfile.findUnique({ where: { personId: id }, include: { person: true } }))
        ?.person.fullName ?? null,
    snapshot: async (db, id) => {
      const s = await db.staffProfile.findUnique({
        where: { personId: id },
        include: { person: true },
      });
      return s
        ? {
            label: s.person.fullName,
            departmentId: s.departmentId,
            data: { staffId: s.staffId, rank: s.academicRank },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const s = await db.staffProfile.findUnique({ where: { personId: id } });
      return s ? { departmentId: s.departmentId, ownerPersonId: s.personId } : null;
    },
    relationships: async (_db, id, personId) => (personId === id ? ["owner"] : []),
    url: (id, slug) => `/d/${slug}/people/${id}`,
  });

  register("student", {
    label: async (db, id) =>
      (await db.student.findUnique({ where: { personId: id }, include: { person: true } }))?.person
        .fullName ?? null,
    snapshot: async (db, id) => {
      const s = await db.student.findUnique({ where: { personId: id }, include: { person: true } });
      return s
        ? {
            label: s.person.fullName,
            status: s.status,
            departmentId: s.departmentId,
            data: { studentNumber: s.studentNumber },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const s = await db.student.findUnique({ where: { personId: id } });
      return s
        ? { departmentId: s.departmentId, ownerPersonId: s.personId, programId: s.programId }
        : null;
    },
    relationships: async (_db, id, personId) => (personId === id ? ["owner"] : []),
    url: (id, slug) => `/d/${slug}/people/${id}`,
  });

  register("program", {
    label: async (db, id) => (await db.program.findUnique({ where: { id } }))?.name ?? null,
    snapshot: async (db, id) => {
      const p = await db.program.findUnique({ where: { id } });
      return p ? { label: `${p.code} ${p.name}`, departmentId: p.departmentId } : null;
    },
    contextOf: async (db, id) => {
      const p = await db.program.findUnique({ where: { id } });
      return p ? { departmentId: p.departmentId, programId: p.id } : null;
    },
    relationships: async () => [],
    url: (_id, slug) => `/d/${slug}/programs`,
  });

  register("section", {
    label: async (db, id) => (await db.section.findUnique({ where: { id } }))?.code ?? null,
    snapshot: async (db, id) => {
      const s = await db.section.findUnique({ where: { id }, include: { program: true } });
      return s
        ? {
            label: s.code,
            departmentId: s.departmentId,
            data: { program: s.program.code, yearLevel: s.yearLevel },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const s = await db.section.findUnique({ where: { id } });
      return s
        ? {
            departmentId: s.departmentId,
            sectionId: s.id,
            programId: s.programId,
            groupId: s.groupId,
          }
        : null;
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const rels: Relationship[] = [];
      const now = new Date();
      if (
        await db.sectionRepresentative.findFirst({
          where: { sectionId: id, studentId: personId, ...openNow(now) },
        })
      )
        rels.push("section_rep");
      if (
        await db.studentSectionMembership.findFirst({
          where: { sectionId: id, studentId: personId, ...openNow(now) },
        })
      )
        rels.push("member");
      return rels;
    },
    url: (_id, slug) => `/d/${slug}/sections`,
  });
  registerGroupSubjects();
}

function registerGroupSubjects(): void {
  register("group", {
    indexDoc: async (db, id) => {
      const group = await db.group.findUnique({ where: { id } });
      return group ? { title: group.name, body: group.kind, keywords: [group.kind] } : null;
    },
    label: async (db, id) => (await db.group.findUnique({ where: { id } }))?.name ?? null,
    snapshot: async (db, id) => {
      const g = await db.group.findUnique({ where: { id } });
      return g
        ? { label: g.name, status: g.status, departmentId: g.departmentId, data: { kind: g.kind } }
        : null;
    },
    contextOf: async (db, id) => {
      const g = await db.group.findUnique({ where: { id } });
      if (!g) return null;
      const committeeId = g.contextType === "committee" && g.contextId ? g.contextId : g.id;
      return {
        departmentId: g.departmentId,
        groupId: g.id,
        ...(g.kind === "committee" ? { committeeId } : {}),
        ...(g.contextType && g.contextId
          ? { parentRef: { subjectType: g.contextType, subjectId: g.contextId } }
          : {}),
      };
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const rows = await db.groupMembership.findMany({
        where: { groupId: id, personId, ...openNow(new Date()) },
      });
      const rels = new Set<Relationship>();
      for (const r of rows) {
        rels.add("member");
        if (r.roleInGroup === "chair" || r.roleInGroup === "lead") rels.add("chair");
      }
      return Array.from(rels);
    },
  });

  register("group_membership", {
    label: async (db, id) => {
      const m = await db.groupMembership.findUnique({
        where: { id },
        include: { person: true, group: true },
      });
      return m ? `${m.person.fullName} in ${m.group.name}` : null;
    },
    snapshot: async (db, id) => {
      const m = await db.groupMembership.findUnique({
        where: { id },
        include: { person: true, group: true },
      });
      return m
        ? {
            label: `${m.person.fullName} in ${m.group.name}`,
            departmentId: m.departmentId,
            data: { role: m.roleInGroup },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const m = await db.groupMembership.findUnique({ where: { id } });
      return m
        ? {
            departmentId: m.departmentId,
            ownerPersonId: m.personId,
            parentRef: { subjectType: "group", subjectId: m.groupId },
          }
        : null;
    },
    relationships: async (db, id, personId) => {
      const m = await db.groupMembership.findUnique({ where: { id } });
      return m && personId === m.personId ? ["owner"] : [];
    },
  });

  register("section_representative", {
    label: async (db, id) => {
      const r = await db.sectionRepresentative.findUnique({
        where: { id },
        include: { student: { include: { person: true } }, section: true },
      });
      return r ? `${r.student.person.fullName} (${r.section.code})` : null;
    },
    snapshot: async (db, id) => {
      const r = await db.sectionRepresentative.findUnique({
        where: { id },
        include: { student: { include: { person: true } }, section: true },
      });
      return r
        ? {
            label: `${r.student.person.fullName} (${r.section.code})`,
            departmentId: r.departmentId,
          }
        : null;
    },
    contextOf: async (db, id) => {
      const r = await db.sectionRepresentative.findUnique({ where: { id } });
      return r
        ? { departmentId: r.departmentId, ownerPersonId: r.studentId, sectionId: r.sectionId }
        : null;
    },
    relationships: async (db, id, personId) => {
      const r = await db.sectionRepresentative.findUnique({ where: { id } });
      return r && personId === r.studentId ? ["owner"] : [];
    },
  });

  register("student_section_membership", {
    label: async (db, id) => {
      const m = await db.studentSectionMembership.findUnique({
        where: { id },
        include: { student: { include: { person: true } }, section: true },
      });
      return m ? `${m.student.person.fullName} in ${m.section.code}` : null;
    },
    snapshot: async (db, id) => {
      const m = await db.studentSectionMembership.findUnique({
        where: { id },
        include: { section: true },
      });
      return m ? { label: m.section.code, departmentId: m.departmentId } : null;
    },
    contextOf: async (db, id) => {
      const m = await db.studentSectionMembership.findUnique({ where: { id } });
      return m
        ? { departmentId: m.departmentId, ownerPersonId: m.studentId, sectionId: m.sectionId }
        : null;
    },
    relationships: async (db, id, personId) => {
      const m = await db.studentSectionMembership.findUnique({ where: { id } });
      return m && personId === m.studentId ? ["owner"] : [];
    },
  });
}
