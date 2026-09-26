"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { toJson } from "@/lib/db/json";
import { publish as emit } from "@/platform/audit/outbox";
import { syncMembership } from "./adapters";

// Changing who is on a committee is not a step of the committee's process — it happens while the
// committee is at work, over and over — so it is an action on the committee, guarded by the same
// permission that constituted it. The record's own fields are kept in step, because they are
// what the process reads when it is replayed.

export const updateMembersAction = safeAction(
  z.object({
    recordId: z.string().min(1),
    members: z.array(z.string().min(1)).default([]),
    chair: z.string().min(1).nullable().default(null),
  }),
  async ({ input, ctx, db }) => {
    const committee = await db.committee.findFirst({ where: { featureRecordId: input.recordId } });
    if (!committee) throw new Error("This record has no committee behind it.");

    const memberIds = Array.from(
      new Set([...(input.chair ? [input.chair] : []), ...input.members]),
    );
    await syncMembership(db, ctx.departmentId, committee.groupId, memberIds, input.chair);
    await db.committee.update({
      where: { id: committee.id },
      data: { chairPersonId: input.chair },
    });

    const record = await db.featureRecord.findUniqueOrThrow({
      where: { id: input.recordId },
      select: { data: true },
    });
    await db.featureRecord.update({
      where: { id: input.recordId },
      data: {
        data: toJson({
          ...((record.data as Record<string, unknown>) ?? {}),
          members: input.members,
          chair: input.chair,
        }),
      },
    });

    await emit(
      db,
      "committee.changed",
      { subjectType: "committee", subjectId: committee.id },
      { members: memberIds.length },
      { departmentId: ctx.departmentId },
    );
    revalidatePath(`/d/${ctx.deptSlug}/f/committee/${input.recordId}`);
    return { members: memberIds.length };
  },
  { permission: "committee.manage", verb: "manage" },
);
