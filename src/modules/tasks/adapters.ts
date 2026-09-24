import { globalSingleton } from "@/lib/singleton";
import { deliverableStatus } from "@/platform/workitem/service";
import { registerFeatureEffect, registerFeatureGuard, taskIdOfSubject } from "../register";

// What the `task` feature needs from code. Everything else about a task — its states, who may
// act, what is asked for — lives in prisma/seed/features/task.ts and is editable in the wizard.

const state = globalSingleton("module-tasks", () => ({ installed: false }));

export function registerTaskAdapters(): void {
  if (state.installed) return;
  state.installed = true;

  registerFeatureGuard(
    {
      key: "task.requiredDeliverablesLinked",
      module: "tasks",
      description: "Every required deliverable slot of the task has a document linked to it.",
      simulable: true,
    },
    async (ctx) => {
      const taskId = await taskIdOfSubject(ctx.tx, ctx.instance);
      if (!taskId) return true;
      const slots = await deliverableStatus(ctx.tx, taskId);
      const missing = slots.filter((s) => s.required && !s.satisfied).map((s) => s.label || s.key);
      return missing.length
        ? { ok: false as const, reason: `Missing required deliverable(s): ${missing.join(", ")}` }
        : true;
    },
  );

  registerFeatureEffect(
    {
      key: "task.setCompletedAt",
      module: "tasks",
      description: "Stamps the backing Task as completed (the derived cache of the terminal state).",
    },
    async (ctx) => {
      const taskId = await taskIdOfSubject(ctx.tx, ctx.instance);
      if (!taskId) return;
      await ctx.tx.task.update({ where: { id: taskId }, data: { completedAt: new Date() } });
    },
  );
}
