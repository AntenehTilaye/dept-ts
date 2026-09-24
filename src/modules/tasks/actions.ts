"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject } from "@/lib/actions/form";
import { safeAction } from "@/lib/actions/safe-action";
import { actorOf } from "@/lib/auth/require";
import { requestUpdate, setDeadline } from "@/platform/workitem";

// What a task's page can do to it beyond its transitions: ask the assignees for an update and
// move the deadline. Creating one, acting on it and reassigning it are the feature runtime's
// job — a task IS a record of the `task` feature — so those actions do not live here.

export const setTaskDeadlineAction = safeAction(
  z.object({ taskId: z.string().min(1), dueAt: z.string().optional() }),
  async ({ input, ctx, db }) => {
    await setDeadline(db, actorOf(ctx), input.taskId, input.dueAt ? new Date(input.dueAt) : null);
    revalidatePath(`/d/${ctx.deptSlug}/tasks/${input.taskId}`);
    return { taskId: input.taskId };
  },
  { permission: "task.manage" },
);

export async function setTaskDeadlineForm(fd: FormData) {
  return setTaskDeadlineAction(formToObject(fd));
}

export const requestUpdateAction = safeAction(
  z.object({ taskId: z.string().min(1), message: z.string().trim().min(3).max(1000) }),
  async ({ input, ctx, db }) => {
    const n = await requestUpdate(db, actorOf(ctx), input.taskId, input.message);
    revalidatePath(`/d/${ctx.deptSlug}/tasks/${input.taskId}`);
    return { notified: n };
  },
  { permission: "task.manage" },
);

export async function requestUpdateForm(fd: FormData) {
  return requestUpdateAction(formToObject(fd));
}
