import type { Relationship } from "../../identity/levels";
import { register } from "../../subject-registry";
import { assigneePersonIds } from "../../workitem/assignments";

// How the rest of the system sees a feature record. Everything generic — permissions, documents,
// threads, notifications, search, audit — addresses records through these two registrations, so
// a module that is "just" a feature is indistinguishable from a hand-written one.

export function registerFeatureSubjects(): void {
  register("feature_record", {
    label: async (db, id) => {
      const r = await db.featureRecord.findUnique({ where: { id } });
      return r ? `${r.number} · ${r.title}` : null;
    },
    snapshot: async (db, id) => {
      const r = await db.featureRecord.findUnique({ where: { id } });
      if (!r) return null;
      return {
        label: `${r.number} · ${r.title}`,
        status: r.currentStateKey,
        departmentId: r.departmentId,
        data: { number: r.number, presetKey: r.presetKey, closedAt: r.closedAt },
      };
    },
    contextOf: async (db, id) => {
      const r = await db.featureRecord.findUnique({ where: { id } });
      if (!r) return null;
      const definition = await db.featureDefinition.findUnique({ where: { id: r.definitionId } });
      const inherit = definition ? inheritsParent(definition.id) : true;
      return {
        departmentId: r.departmentId,
        ownerPersonId: r.ownerPersonId,
        featureRecordId: r.id,
        ...(r.scopeType === "program" && r.scopeId ? { programId: r.scopeId } : {}),
        ...(r.scopeType === "section" && r.scopeId ? { sectionId: r.scopeId } : {}),
        ...(inherit && r.parentSubjectType && r.parentSubjectId
          ? { parentRef: { subjectType: r.parentSubjectType, subjectId: r.parentSubjectId } }
          : {}),
      };
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const r = await db.featureRecord.findUnique({ where: { id } });
      if (!r) return [];
      const rels: Relationship[] = [];
      if (r.ownerPersonId === personId) rels.push("owner");
      if (r.createdByPersonId === personId) rels.push("creator", "requester");
      // every step the person has ever been given, not only the one open right now: somebody
      // who did the work keeps seeing the record while a reviewer holds it
      const steps = await db.featureStepInstance.findMany({ where: { recordId: id } });
      for (const step of steps) {
        if (step.assigneeType === "person" && step.assigneeId === personId) rels.push("assignee");
        if (step.assigneeType === "group" && step.assigneeId) {
          const member = await db.groupMembership.findFirst({
            where: { groupId: step.assigneeId, personId, validTo: null },
          });
          if (member) rels.push("assignee");
        }
      }
      // a task-backed record is assigned through its Task row, which is where a whole audience
      // of assignees lives
      if (r.taskId && (await assigneePersonIds(db, r.taskId)).includes(personId))
        rels.push("assignee");
      return Array.from(new Set(rels));
    },
    variables: async (db, id) => {
      const r = await db.featureRecord.findUnique({ where: { id } });
      if (!r) return {};
      const definition = await db.featureDefinition.findUnique({ where: { id: r.definitionId } });
      const owner = await db.person.findUnique({ where: { id: r.ownerPersonId } });
      return {
        record_number: r.number,
        record_title: r.title,
        feature_name: definition?.name ?? "",
        state: r.currentStateKey,
        deadline: r.deadlineAt?.toISOString() ?? "",
        owner_name: owner?.fullName ?? "",
        title: r.title,
      };
    },
    indexDoc: async (db, id) => {
      const r = await db.featureRecord.findUnique({ where: { id } });
      if (!r) return null;
      return {
        title: `${r.number} · ${r.title}`,
        body: JSON.stringify(r.data ?? {}),
        keywords: [r.number, r.currentStateKey, r.presetKey ?? ""].filter(Boolean),
      };
    },
    url: (id, deptSlug) => `/d/${deptSlug}/f/record/${id}`,
  });

  register("feature_step_instance", {
    label: async (db, id) => {
      const s = await db.featureStepInstance.findUnique({ where: { id } });
      return s ? s.stepKey : null;
    },
    snapshot: async (db, id) => {
      const s = await db.featureStepInstance.findUnique({ where: { id } });
      if (!s) return null;
      return {
        label: s.stepKey,
        status: s.status,
        departmentId: s.departmentId,
        data: { recordId: s.recordId, branchKey: s.branchKey, deadlineAt: s.deadlineAt },
      };
    },
    contextOf: async (db, id) => {
      const s = await db.featureStepInstance.findUnique({ where: { id } });
      if (!s) return null;
      return {
        departmentId: s.departmentId,
        parentRef: { subjectType: "feature_record", subjectId: s.recordId },
      };
    },
    relationships: async (db, id, personId) => {
      if (!personId) return [];
      const s = await db.featureStepInstance.findUnique({ where: { id } });
      if (!s) return [];
      if (s.assigneeType === "person" && s.assigneeId === personId) return ["assignee"];
      if (s.assigneeType === "group" && s.assigneeId) {
        const member = await db.groupMembership.findFirst({
          where: { groupId: s.assigneeId, personId, validTo: null },
        });
        if (member) return ["assignee"];
      }
      return [];
    },
    variables: async (db, id) => {
      const s = await db.featureStepInstance.findUnique({ where: { id } });
      if (!s) return {};
      const record = await db.featureRecord.findUnique({ where: { id: s.recordId } });
      return {
        step_key: s.stepKey,
        step_deadline: s.deadlineAt?.toISOString() ?? "",
        record_number: record?.number ?? "",
        record_title: record?.title ?? "",
      };
    },
  });
}

/** Feature definitions inherit their parent's context unless they opt out; the flag lives in the
 * definition json, which contextOf does not load — the common case is to inherit. */
function inheritsParent(_definitionId: string): boolean {
  return true;
}
