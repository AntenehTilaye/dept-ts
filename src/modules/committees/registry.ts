import { globalSingleton } from "@/lib/singleton";
import type { Db } from "@/lib/db/types";
import type { Relationship } from "@/platform/identity/levels";
import { register } from "@/platform/subject-registry";

// How the rest of the platform refers to a committee and to one of its reports. Registering these
// is what lets a task hang under a committee, a notification name it, a search hit link to it and
// a permission scoped to it be found — none of which is committee code.

const openNow = (now: Date) => ({
  validFrom: { lte: now },
  OR: [{ validTo: null }, { validTo: { gt: now } }],
});

function day(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

// registerModules() is called both by the web bootstrap and by the seed, and registering a
// subject type twice is an error rather than a no-op, so the module owns the flag
const state = globalSingleton("module-committee-subjects", () => ({ installed: false }));

export function registerCommitteeSubjects(): void {
  if (state.installed) return;
  state.installed = true;
  register("committee", {
    label: async (db, id) => (await db.committee.findUnique({ where: { id } }))?.name ?? null,
    snapshot: async (db, id) => {
      const c = await db.committee.findUnique({ where: { id }, include: { group: true } });
      return c
        ? {
            label: c.name,
            status: c.group.status,
            departmentId: c.departmentId,
            data: { type: c.type, chairPersonId: c.chairPersonId },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const c = await db.committee.findUnique({ where: { id } });
      return c
        ? {
            departmentId: c.departmentId,
            committeeId: c.id,
            groupId: c.groupId,
            ...(c.chairPersonId ? { ownerPersonId: c.chairPersonId } : {}),
          }
        : null;
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const c = await db.committee.findUnique({ where: { id }, select: { groupId: true } });
      if (!c) return [];
      const rows = await db.groupMembership.findMany({
        where: { groupId: c.groupId, personId, ...openNow(new Date()) },
      });
      const rels = new Set<Relationship>();
      for (const row of rows) {
        rels.add("member");
        if (row.roleInGroup === "chair") rels.add("chair");
      }
      return Array.from(rels);
    },
    variables: async (db, id) => {
      const c = await db.committee.findUnique({ where: { id }, include: { chair: true } });
      return c
        ? {
            committee_name: c.name,
            chair_name: c.chair?.fullName ?? "",
            committee_type: c.type ?? "",
          }
        : {};
    },
    indexDoc: async (db, id) => {
      const c = await db.committee.findUnique({ where: { id } });
      if (!c) return null;
      return {
        title: c.name,
        body: [c.purpose, c.responsibilitiesText].filter(Boolean).join("\n"),
        keywords: [c.type, "committee"].filter((k): k is string => !!k),
      };
    },
    // the committee and its record share an id, so this is the record page
    url: (id, slug) => `/d/${slug}/committees/${id}`,
  });

  register("committee_report", {
    label: async (db, id) => {
      const r = await db.committeeReport.findUnique({ where: { id }, include: { committee: true } });
      return r ? `${r.committee.name}: ${day(r.periodFrom)} to ${day(r.periodTo)}` : null;
    },
    snapshot: async (db, id) => {
      const r = await db.committeeReport.findUnique({ where: { id }, include: { committee: true } });
      return r
        ? {
            label: `${r.committee.name}: ${day(r.periodFrom)} to ${day(r.periodTo)}`,
            status: r.submittedAt ? "submitted" : "draft",
            departmentId: r.departmentId,
            data: { committeeId: r.committeeId, submittedAt: r.submittedAt },
          }
        : null;
    },
    contextOf: async (db, id) => {
      const r = await db.committeeReport.findUnique({ where: { id }, include: { committee: true } });
      return r
        ? {
            departmentId: r.departmentId,
            committeeId: r.committeeId,
            groupId: r.committee.groupId,
            ownerPersonId: r.authorPersonId,
            parentRef: { subjectType: "committee", subjectId: r.committeeId },
          }
        : null;
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const r = await db.committeeReport.findUnique({ where: { id }, include: { committee: true } });
      if (!r) return [];
      const rels = new Set<Relationship>();
      if (r.authorPersonId === personId) rels.add("owner");
      const rows = await db.groupMembership.findMany({
        where: { groupId: r.committee.groupId, personId, ...openNow(new Date()) },
      });
      for (const row of rows) {
        rels.add("member");
        if (row.roleInGroup === "chair") rels.add("chair");
      }
      return Array.from(rels);
    },
    variables: async (db, id) => {
      const r = await db.committeeReport.findUnique({ where: { id }, include: { committee: true } });
      return r
        ? {
            committee_name: r.committee.name,
            period_from: day(r.periodFrom) ?? "",
            period_to: day(r.periodTo) ?? "",
          }
        : {};
    },
    url: (id, slug) => `/d/${slug}/f/committee_report/${id}`,
  });
}

/** The feature record a committee is, so a page can go from the committee to its process. */
export async function recordIdOfCommittee(db: Db, committeeId: string): Promise<string | null> {
  const c = await db.committee.findUnique({
    where: { id: committeeId },
    select: { featureRecordId: true },
  });
  return c?.featureRecordId ?? null;
}
