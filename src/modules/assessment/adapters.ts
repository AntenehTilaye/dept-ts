import { globalSingleton } from "@/lib/singleton";
import { publish as emit } from "@/platform/audit/outbox";
import { ensureOffering } from "@/platform/academic/offerings";
import { can } from "@/platform/identity/can";
import { dbPolicyStore } from "@/platform/identity/policy-store";
import {
  registerCommitAuthority,
  registerCommitter,
  registerValidator,
} from "@/platform/import";
import { registerStepAdapter } from "../register";
import { commitAssessment, commitAttendance, commitStudents } from "./committers";
import { registerAssessmentKinds } from "./templates";
import { validateAssessment, validateAttendance, validateStudents } from "./validators";

// What this module adds to the import pipeline: three kinds of file it knows how to read and
// write, and the rule about who may write them. The pipeline itself — the upload, the mapping, the
// preview, the fixes, the commit transaction — is P10's and is reused exactly as it is.

const state = globalSingleton("module-assessment", () => ({ installed: false }));

/**
 * A section's marks are the business of whoever teaches it. Anybody who manages imports or the
 * academic registry may commit for any section; an instructor may commit for the sections they
 * actually hold a teaching assignment on, and for no others.
 */
async function sectionAuthority(ctx: {
  tx: import("@/lib/db/types").Db;
  actor: import("@/platform/identity/can").Actor;
  context?: { subjectType: string; subjectId: string } | null;
}): Promise<true | { ok: false; reason: string }> {
  for (const key of ["import.manage", "academic.manage"]) {
    const decision = await can(dbPolicyStore, ctx.actor, key, undefined, { verb: "approve" });
    if (decision.allowed) return true;
  }
  if (ctx.context?.subjectType !== "section_offering" || !ctx.context.subjectId)
    return { ok: false, reason: "These marks belong to no section, so nobody owns them" };
  if (!ctx.actor.personId)
    return { ok: false, reason: "Only a person may commit marks" };

  const teaches = await ctx.tx.teachingAssignment.findFirst({
    where: { sectionOfferingId: ctx.context.subjectId, personId: ctx.actor.personId },
  });
  if (!teaches)
    return { ok: false, reason: "Only somebody teaching this section may commit its marks" };
  // the section itself is the subject, so `assigned` is satisfied by the assignment just found
  const decision = await can(dbPolicyStore, ctx.actor, "assessment.import", ctx.context, {
    verb: "submit",
  });
  return decision.allowed ? true : { ok: false, reason: decision.reason };
}

export function registerAssessmentAdapters(): void {
  if (state.installed) return;
  state.installed = true;

  registerAssessmentKinds();

  registerValidator("assessment", validateAssessment);
  registerCommitter("assessment", commitAssessment);
  registerCommitAuthority("assessment", sectionAuthority);

  registerValidator("attendance", validateAttendance);
  registerCommitter("attendance", commitAttendance);
  registerCommitAuthority("attendance", sectionAuthority);

  registerValidator("students", validateStudents);
  registerCommitter("students", commitStudents);

  registerStepAdapter(
    {
      key: "course_offering.backing",
      module: "assessment",
      hook: "backing",
      description: "Links the record to the course offering it is the life of.",
    },
    async (ctx) => {
      if (!ctx.record) return;
      const data = ctx.record.data ?? {};
      const record = await ctx.tx.featureRecord.findUniqueOrThrow({
        where: { id: ctx.record.id },
        select: { parentSubjectType: true, parentSubjectId: true },
      });
      if (record.parentSubjectType !== "course" || !record.parentSubjectId)
        throw new Error("An offering is always of a course");
      const termId = typeof data.term === "string" ? data.term : null;
      if (!termId) throw new Error("An offering is always in a term");

      const offering = await ensureOffering(ctx.tx, ctx.departmentId, {
        courseId: record.parentSubjectId,
        termId,
        coordinatorPersonId:
          typeof data.coordinator === "string" && data.coordinator ? data.coordinator : null,
        featureRecordId: ctx.record.id,
      });
      return { course_offering_id: offering.id, term_id: termId };
    },
  );
}

/** The offering a record stands for, by the record's id. */
export async function offeringOfRecord(
  tx: import("@/lib/db/types").Db,
  featureRecordId: string,
): Promise<{ id: string; termId: string; courseId: string } | null> {
  const offering = await tx.courseOffering.findFirst({
    where: { featureRecordId },
    select: { id: true, termId: true, courseId: true },
  });
  return offering ?? null;
}

/** Emitted when an offering is stood down, so whoever was teaching it hears about it. */
export async function announceCancelled(
  tx: import("@/lib/db/types").Db,
  departmentId: string,
  offeringId: string,
): Promise<void> {
  await emit(
    tx,
    "offering.cancelled",
    { subjectType: "course_offering", subjectId: offeringId },
    {},
    { departmentId },
  );
}
