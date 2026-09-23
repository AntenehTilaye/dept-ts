"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";
import { formToObject } from "@/lib/actions/form";
import { safeAction } from "@/lib/actions/safe-action";
import { actorOf } from "@/lib/auth/require";
import { applyIn } from "@/platform/workflow/engine";
import { assign, createTask, requestUpdate, setDeadline, taskInstance } from "@/platform/workitem";

// Server actions of the interim task pages (P9 replaces these pages with the generic feature
// runtime; the service calls stay the same).

const DeliverableSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  required: z.boolean().default(false),
});

export const createTaskAction = safeAction(
  z.object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(4000).optional(),
    kind: z
      .enum(["general", "committee_task", "department_task", "instructor_task", "administrative"])
      .default("general"),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    dueAt: z.string().optional(),
    assigneePersonIds: z.array(z.string().min(1)).default([]),
    audienceRoles: z.array(z.string().min(1)).default([]),
    deliverables: z.array(DeliverableSchema).default([]),
  }),
  async ({ input, ctx, db }) => {
    const assignees = [
      ...input.assigneePersonIds.map((id) => ({ type: "person" as const, id })),
      ...(input.audienceRoles.length
        ? [{ type: "audience" as const, audienceSpec: { roles: input.audienceRoles } }]
        : []),
    ];
    const task = await createTask(db, actorOf(ctx), {
      title: input.title,
      description: input.description ?? null,
      kind: input.kind,
      priority: input.priority,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      assignees,
      expectedDeliverables: input.deliverables,
    });
    revalidatePath(`/d/${ctx.deptSlug}/tasks`);
    return { id: task.id };
  },
  { permission: "task.create" },
);

export async function createTaskForm(fd: FormData) {
  const raw = formToObject(fd, { arrays: ["assigneePersonIds", "audienceRoles"] }) as Record<
    string,
    unknown
  >;
  // deliverables arrive as "key|label|required" lines from the textarea
  const text = typeof raw.deliverablesText === "string" ? raw.deliverablesText : "";
  raw.deliverables = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, label, required] = line.split("|").map((p) => p.trim());
      return {
        key: key ?? "",
        label: label || key || "",
        required: (required ?? "").toLowerCase() === "required",
      };
    });
  delete raw.deliverablesText;
  const result = await createTaskAction(raw);
  if (result.ok) {
    const dept = String((raw as { dept?: string }).dept ?? "");
    redirect(`/d/${dept}/tasks/${result.data.id}` as Route);
  }
  return result;
}

export const transitionTaskAction = safeAction(
  z.object({
    taskId: z.string().min(1),
    transitionKey: z.string().min(1),
    comment: z.string().max(2000).optional(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
  async ({ input, ctx, db }) => {
    const instance = await taskInstance(db, input.taskId);
    if (!instance) throw new Error("This task has no workflow instance");
    const result = await applyIn(db, instance.id, input.transitionKey, actorOf(ctx), {
      comment: input.comment,
      fields: input.fields,
      expectedState: instance.currentState,
    });
    revalidatePath(`/d/${ctx.deptSlug}/tasks/${input.taskId}`);
    revalidatePath(`/d/${ctx.deptSlug}/my-work`);
    return { state: result.instance.currentState };
  },
);

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

export const assignTaskAction = safeAction(
  z.object({ taskId: z.string().min(1), personIds: z.array(z.string().min(1)).min(1) }),
  async ({ input, ctx, db }) => {
    await assign(
      db,
      actorOf(ctx),
      input.taskId,
      input.personIds.map((id) => ({ type: "person" as const, id })),
    );
    revalidatePath(`/d/${ctx.deptSlug}/tasks/${input.taskId}`);
    return { taskId: input.taskId };
  },
  { permission: "task.manage" },
);

export async function assignTaskForm(fd: FormData) {
  return assignTaskAction(formToObject(fd, { arrays: ["personIds"] }));
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
