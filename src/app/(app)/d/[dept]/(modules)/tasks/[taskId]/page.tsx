import { notFound } from "next/navigation";
import { dbOf, pageContext } from "@/lib/auth/page";
import { canDo, requireCan } from "@/lib/auth/require";
import { isOverdue } from "@/platform/workitem";
import { taskDefinition } from "@/platform/workflow/definitions/task";
import { fmtDate, fmtDateTime } from "@/components/forms/Field";
import { SubjectDocuments } from "@/components/documents/SubjectDocuments";
import { SubjectThread } from "@/components/thread/SubjectThread";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { taskDetail } from "@/modules/tasks/queries";
import { TaskRecord } from "@/modules/tasks/TaskRecord";
import { requestUpdateForm, setTaskDeadlineForm } from "@/modules/tasks/actions";

export const dynamic = "force-dynamic";

export default async function TaskPage(props: PageProps<"/d/[dept]/tasks/[taskId]">) {
  const { dept, taskId } = await props.params;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);
  const detail = await taskDetail(ctx, db, taskId);
  if (!detail) notFound();
  // relational levels (assignee, creator) only resolve against the subject itself
  await requireCan(ctx, "task.view", { subjectType: "task", subjectId: taskId }, "read");
  const { task, instance, actions, slots, assignees, history, steps, canContribute } = detail;
  const canManage = (await canDo(ctx, "task.manage")).allowed;
  const state = taskDefinition.states.find((s) => s.key === instance?.currentState);
  const overdue = isOverdue(task, instance?.currentState ?? null);
  const subject = { subjectType: "task", subjectId: taskId };
  const path = `/d/${dept}/tasks/${taskId}`;

  return (
    <TaskRecord
      dept={dept}
      taskId={taskId}
      crumbs={[{ label: "Tasks", href: `/d/${dept}/tasks` }, { label: task.title }]}
      title={task.title}
      description={task.description}
      state={{
        key: instance?.currentState ?? "draft",
        label: state?.label ?? instance?.currentState ?? "Draft",
        category: state?.category,
        terminalCategory: state?.terminalCategory,
      }}
      overdue={overdue}
      dueLabel={task.dueAt ? `due ${fmtDate(task.dueAt)}` : null}
      steps={steps}
      actions={actions}
      fields={[
        { key: "kind", label: "Kind", value: task.kind, badge: true },
        { key: "priority", label: "Priority", value: task.priority, badge: true },
        { key: "due", label: "Deadline", value: task.dueAt ? fmtDateTime(task.dueAt) : "none" },
        {
          key: "assignees",
          label: "Assignees",
          value: assignees.map((a) => a.name).join(", ") || "none",
        },
        {
          key: "completed",
          label: "Completed",
          value: task.completedAt ? fmtDateTime(task.completedAt) : "",
        },
        { key: "description", label: "Description", value: task.description, wide: true },
      ]}
      slots={slots.map((s) => ({
        slotKey: s.key,
        label: s.label,
        required: s.required,
        satisfied: s.satisfied,
        documentId: s.documentId,
      }))}
      slotSubject={subject}
      canUploadSlots={canContribute}
      acknowledgements={assignees}
      history={history}
      documents={<SubjectDocuments ctx={ctx} db={db} subject={subject} path={path} />}
      comments={<SubjectThread ctx={ctx} db={db} subject={subject} path={path} />}
      extras={
        canManage
          ? [
              {
                key: "manage",
                label: "Manage",
                content: (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle>Move the deadline</CardTitle>
                        <CardDescription>
                          Cancels the scheduled reminders and subscribes new ones.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ActionForm
                          action={setTaskDeadlineForm}
                          submitLabel="Save deadline"
                          successMessage="Deadline updated."
                          className="grid gap-3"
                          resetOnSuccess={false}
                        >
                          <input type="hidden" name="dept" value={dept} />
                          <input type="hidden" name="taskId" value={taskId} />
                          <Field
                            name="dueAt"
                            label="Due"
                            type="datetime-local"
                            defaultValue={
                              task.dueAt ? task.dueAt.toISOString().slice(0, 16) : undefined
                            }
                          />
                        </ActionForm>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>Ask for an update</CardTitle>
                        <CardDescription>
                          Notifies the responsible assignees without changing the state.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ActionForm
                          action={requestUpdateForm}
                          submitLabel="Request update"
                          successMessage="Update requested."
                          className="grid gap-3"
                        >
                          <input type="hidden" name="dept" value={dept} />
                          <input type="hidden" name="taskId" value={taskId} />
                          <Field
                            name="message"
                            label="Message"
                            required
                            placeholder="Where are we?"
                          />
                        </ActionForm>
                      </CardContent>
                    </Card>
                  </div>
                ),
              },
            ]
          : undefined
      }
    />
  );
}
