"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction } from "@/lib/actions/safe-action";
import { formToObject } from "@/lib/actions/form";
import { getBoss } from "@/lib/db/boss";
import { withTenantBypass } from "@/lib/db/tenant";

const byId = z.object({ id: z.string().min(1) });

/** Replays a dead outbox event (clears deadAt/attempts; the dispatcher picks it up again). */
export const replayEventAction = adminAction(byId, async ({ input, ctx }) => {
  await withTenantBypass(
    { isAdmin: true, user: { id: ctx.user.id } },
    `replay event ${input.id}`,
    (tx) =>
      tx.domainEvent.update({
        where: { id: input.id },
        data: { deadAt: null, attempts: 0, lastError: null },
      }),
  );
  const boss = await getBoss();
  await boss.send("outbox.dispatch", {}).catch(() => undefined);
  revalidatePath("/admin/jobs");
  return { id: input.id };
});

/** Cancels a scheduled ledger row and its pg-boss job. */
export const cancelJobAction = adminAction(byId, async ({ input, ctx }) => {
  await withTenantBypass(
    { isAdmin: true, user: { id: ctx.user.id } },
    `cancel job ${input.id}`,
    async (tx) => {
      const row = await tx.scheduledJob.findUniqueOrThrow({ where: { id: input.id } });
      await tx.scheduledJob.update({ where: { id: row.id }, data: { status: "cancelled" } });
      if (row.pgBossJobId)
        await (await getBoss()).cancel(row.queue, row.pgBossJobId).catch(() => undefined);
    },
  );
  revalidatePath("/admin/jobs");
  return { id: input.id };
});

/** Re-sends a failed ledger row to its queue with the stored payload. */
export const retryJobAction = adminAction(byId, async ({ input, ctx }) => {
  await withTenantBypass(
    { isAdmin: true, user: { id: ctx.user.id } },
    `retry job ${input.id}`,
    async (tx) => {
      const row = await tx.scheduledJob.findUniqueOrThrow({ where: { id: input.id } });
      const payload =
        typeof row.payloadJson === "object" && row.payloadJson
          ? (row.payloadJson as Record<string, unknown>)
          : {};
      const jobId = await (
        await getBoss()
      ).send(
        row.queue,
        { ...payload, idempotencyKey: row.idempotencyKey, departmentId: row.departmentId },
        { singletonKey: `${row.idempotencyKey}:retry:${Date.now()}` },
      );
      await tx.scheduledJob.update({
        where: { id: row.id },
        data: { status: "scheduled", pgBossJobId: jobId, lastError: null },
      });
    },
  );
  revalidatePath("/admin/jobs");
  return { id: input.id };
});

export async function replayEventForm(fd: FormData) {
  return replayEventAction(formToObject(fd));
}
export async function cancelJobForm(fd: FormData) {
  return cancelJobAction(formToObject(fd));
}
export async function retryJobForm(fd: FormData) {
  return retryJobAction(formToObject(fd));
}

/**
 * The two rebuilds an administrator may need: the search index and the dashboard projections.
 * Both are derived data — a rebuild costs time, never correctness — so the button is safe to
 * press, and both are queued rather than run in the request.
 */
export const rebuildAction = adminAction(
  z.object({ what: z.enum(["search", "projections"]), departmentId: z.string().optional() }),
  async ({ input }) => {
    const queue = input.what === "search" ? "search.reindex" : "projection.rebuild";
    const boss = await getBoss();
    await boss.send(queue, input.departmentId ? { departmentId: input.departmentId } : {});
    revalidatePath("/admin/jobs");
    return { queue };
  },
);

export async function rebuildForm(fd: FormData) {
  return rebuildAction(formToObject(fd));
}
