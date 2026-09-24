import { globalSingleton } from "@/lib/singleton";
import { registerFeatureEffect, registerStepAdapter, taskIdOfSubject } from "../register";
import { subscribeReminders, cancelBySubject } from "@/platform/scheduler/reminders";

// A case has no deliverable and no deadline: it is nudged at an interval while it is open, and
// it closes itself once it has been resolved long enough for nobody to object.

const state = globalSingleton("module-cases", () => ({ installed: false }));
const NUDGE_SCHEDULE = "case_interval_nudge";

export function registerCaseAdapters(): void {
  if (state.installed) return;
  state.installed = true;

  registerStepAdapter(
    {
      key: "case.subscribeIntervalNudge",
      module: "cases",
      hook: "on_enter",
      description: "Nudges the handler every few days while the case is open.",
    },
    async (ctx) => {
      if (!ctx.stepInstance || !ctx.record) return;
      await subscribeReminders(ctx.tx, ctx.departmentId, {
        subject: { subjectType: "feature_step_instance", subjectId: ctx.stepInstance.id },
        scheduleKey: NUDGE_SCHEDULE,
        deadline: { everyDays: 7, whileInStates: ["in_progress"] },
        audienceSpec: { roles: ["department_head"] },
        variables: { record_title: String(ctx.record.data.summary ?? "") },
      });
    },
  );

  registerStepAdapter(
    {
      key: "case.cancelNudge",
      module: "cases",
      hook: "on_exit",
      description: "Stops the interval nudge when the case leaves the handling step.",
    },
    async (ctx) => {
      if (!ctx.stepInstance) return;
      await cancelBySubject(
        ctx.tx,
        { subjectType: "feature_step_instance", subjectId: ctx.stepInstance.id },
        NUDGE_SCHEDULE,
      );
    },
  );

  registerFeatureEffect(
    {
      key: "case.setResolvedAt",
      module: "cases",
      description: "Stamps the Case extension row as resolved.",
    },
    async (ctx) => {
      const taskId = await taskIdOfSubject(ctx.tx, ctx.instance);
      if (!taskId) return;
      await ctx.tx.case.updateMany({ where: { taskId }, data: { resolvedAt: new Date() } });
    },
  );

  registerFeatureEffect(
    {
      key: "case.autoClose",
      module: "cases",
      description: "Closes a resolved case nobody reopened.",
    },
    async (ctx) => {
      const taskId = await taskIdOfSubject(ctx.tx, ctx.instance);
      if (!taskId) return;
      await ctx.tx.task.update({ where: { id: taskId }, data: { completedAt: new Date() } });
    },
  );
}
