import { notify } from "@/platform/scheduler/notify";
import { registerFeatureEffect } from "../register";
import { announceCancelled, offeringOfRecord } from "./adapters";
import { freezeSnapshots } from "./snapshots";

// What an offering's transitions do beyond moving the record. Closing one freezes the figures it
// produced, because a course that is over is a course whose numbers the department will quote; and
// standing one down has to reach the people who were going to teach it.

export function registerOfferingEffects(): void {
  registerFeatureEffect(
    {
      key: "offering.freezeSnapshots",
      module: "assessment",
      description: "Freezes the figures of a closed offering, so a published number cannot move.",
    },
    async (ctx) => {
      const offering = await offeringOfRecord(ctx.tx, ctx.instance.subjectId);
      if (!offering) return;
      const frozen = await freezeSnapshots(ctx.tx, offering.id);
      if (frozen)
        console.log(`[offering.freezeSnapshots] ${offering.id}: ${frozen} snapshot(s) frozen`);
    },
  );

  registerFeatureEffect(
    {
      key: "offering.notifyCancelled",
      module: "assessment",
      description: "Tells whoever was teaching an offering that it will not run.",
    },
    async (ctx) => {
      const offering = await offeringOfRecord(ctx.tx, ctx.instance.subjectId);
      if (!offering) return;
      const assignments = await ctx.tx.teachingAssignment.findMany({
        where: { sectionOffering: { courseOfferingId: offering.id } },
        select: { personId: true },
      });
      const recipients = Array.from(new Set(assignments.map((a) => a.personId)));
      if (recipients.length)
        await notify(ctx.tx, ctx.instance.departmentId, {
          recipients,
          templateKey: "offering_cancelled",
          category: "workflow",
          subject: { subjectType: "course_offering", subjectId: offering.id },
          variables: { comment: ctx.input.comment ?? "" },
          dedupeKey: `offering_cancelled:${offering.id}`,
        });
      await announceCancelled(ctx.tx, ctx.instance.departmentId, offering.id);
    },
  );
}
