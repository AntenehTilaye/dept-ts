"use client";

import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requestUpdateForm, setTaskDeadlineForm } from "./actions";

/**
 * The two things a task's creator can do to it that are not transitions: ask the assignees for
 * an update, and move the deadline (which re-schedules the reminders).
 */
export function TaskActionsPanel({ dept, taskId }: { dept: string; taskId: string }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <ActionForm
        action={requestUpdateForm}
        submitLabel="Ask for an update"
        successMessage="The assignees were asked."
        className="grid gap-2"
      >
        <input type="hidden" name="dept" value={dept} />
        <input type="hidden" name="taskId" value={taskId} />
        <Label htmlFor="task-update-note">Ask the assignees for an update</Label>
        <Textarea
          id="task-update-note"
          name="comment"
          rows={3}
          placeholder="What would you like to know?"
        />
      </ActionForm>

      <ActionForm
        action={setTaskDeadlineForm}
        submitLabel="Move the deadline"
        successMessage="The deadline moved; reminders follow it."
        className="grid gap-2"
      >
        <input type="hidden" name="dept" value={dept} />
        <input type="hidden" name="taskId" value={taskId} />
        <Field name="dueAt" label="New deadline" type="datetime-local" />
      </ActionForm>
    </div>
  );
}
