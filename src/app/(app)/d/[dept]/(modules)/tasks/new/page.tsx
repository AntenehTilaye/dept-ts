import { dbOf, pageContextCan } from "@/lib/auth/page";
import { listStaff } from "@/platform/people/staff";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { FormSection } from "@/components/patterns/FormSection";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTaskForm } from "@/modules/tasks/actions";

export const dynamic = "force-dynamic";

const KINDS = [
  "general",
  "committee_task",
  "department_task",
  "instructor_task",
  "administrative",
] as const;

const AUDIENCE_ROLES = [
  { key: "instructor", label: "Every instructor" },
  { key: "committee_chair", label: "Every committee chair" },
  { key: "student_rep", label: "Every section representative" },
] as const;

export default async function NewTaskPage(props: PageProps<"/d/[dept]/tasks/new">) {
  const { dept } = await props.params;
  const ctx = await pageContextCan(dept, "task.create");
  const staff = await listStaff(dbOf(ctx), ctx.departmentId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: "Tasks", href: `/d/${dept}/tasks` }, { label: "New task" }]}
        title="New task"
        description="Assignees are notified and must acknowledge; a deadline schedules the reminders automatically."
      />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>What needs doing</CardTitle>
          <CardDescription>
            Deliverable slots make the submission conditional: a required slot must hold a file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createTaskForm}
            submitLabel="Create task"
            successMessage="Task created."
            className="grid gap-4"
          >
            <input type="hidden" name="dept" value={dept} />
            <Field name="title" label="Title" required placeholder="Prepare the CS201 exam paper" />
            <div className="grid gap-1.5">
              <Label htmlFor="task-description">Description</Label>
              <Textarea
                id="task-description"
                name="description"
                rows={3}
                placeholder="What exactly is expected?"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField name="kind" label="Kind" defaultValue="general">
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </SelectField>
              <SelectField name="priority" label="Priority" defaultValue="normal">
                {["low", "normal", "high", "urgent"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </SelectField>
              <Field
                name="dueAt"
                label="Due"
                type="datetime-local"
                hint="Reminders fire 7, 3 and 1 days before, on the day and when overdue."
              />
            </div>

            <FormSection
              title="Assign to"
              description="People are notified individually; an audience is snapshotted into a group at creation."
            >
              <SelectField name="assigneePersonIds" label="Person" emptyLabel="(none)">
                {staff.map((s) => (
                  <option key={s.personId} value={s.personId}>
                    {s.person.fullName}
                  </option>
                ))}
              </SelectField>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">Audience</legend>
                {AUDIENCE_ROLES.map((r) => (
                  <label key={r.key} className="flex items-center gap-2 text-sm">
                    <Checkbox name="audienceRoles" value={r.key} />
                    {r.label}
                  </label>
                ))}
              </fieldset>
            </FormSection>

            <FormSection
              title="Deliverables"
              description="One per line: key | label | required — for example report | Final report | required"
            >
              <Textarea
                id="task-deliverables"
                name="deliverablesText"
                rows={3}
                placeholder={"report | Final report | required\nannex | Annex"}
                aria-label="Deliverable slots"
              />
            </FormSection>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
