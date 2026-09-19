import { dbOf, pageContextCan } from "@/lib/auth/page";
import { listResources } from "@/platform/academic/resources";
import { listStaff } from "@/platform/people/staff";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { FormSection } from "@/components/patterns/FormSection";
import { ListLayout } from "@/components/patterns/ListLayout";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ResourcesTable } from "@/components/tables/SimpleTables";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { upsertResourceForm } from "./actions";

export const dynamic = "force-dynamic";

const KINDS = [
  "classroom",
  "computer_lab",
  "meeting_room",
  "office",
  "exam_hall",
  "other",
] as const;

export default async function ResourcesPage(props: PageProps<"/d/[dept]/resources">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContextCan(dept, "academic.manage");
  const db = dbOf(ctx);
  const [resources, staff] = await Promise.all([
    listResources(db, ctx.departmentId),
    listStaff(db, ctx.departmentId),
  ]);
  const editing =
    typeof params.edit === "string" ? resources.find((r) => r.id === params.edit) : undefined;
  const rows = resources.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    capacity: r.capacity?.toString() ?? "—",
    responsible: r.responsible?.fullName ?? "—",
    status: r.status,
    detail:
      r.kind === "computer_lab" ? `${r.computerCount ?? 0} PCs · ${r.softwareList.join(", ")}` : "",
    editHref: `/d/${dept}/resources?edit=${r.id}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Resources"
        description="Rooms, labs and halls that timetables, exams and meetings are placed in."
      />
      <ListLayout
        aside={
          <Card>
            <CardHeader>
              <CardTitle>{editing ? `Edit ${editing.code}` : "Add a resource"}</CardTitle>
              {editing ? (
                <CardDescription>
                  <a className="underline" href={`/d/${dept}/resources`}>
                    Cancel editing
                  </a>
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent>
              <ActionForm
                action={upsertResourceForm}
                submitLabel={editing ? "Save" : "Add resource"}
                successMessage="Resource saved."
                className="grid gap-4"
                resetOnSuccess={!editing}
              >
                <input type="hidden" name="dept" value={dept} />
                {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
                <Field
                  name="code"
                  label="Code"
                  required
                  defaultValue={editing?.code}
                  placeholder="R102"
                />
                <Field name="name" label="Name" required defaultValue={editing?.name} />
                <SelectField
                  name="kind"
                  label="Kind"
                  required
                  defaultValue={editing?.kind ?? "classroom"}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </SelectField>
                <FormSection title="Where and how big">
                  <Field name="building" label="Building" defaultValue={editing?.building ?? ""} />
                  <Field name="location" label="Location" defaultValue={editing?.location ?? ""} />
                  <Field
                    name="capacity"
                    label="Capacity"
                    type="number"
                    defaultValue={editing?.capacity ?? ""}
                    min={1}
                  />
                </FormSection>
                <FormSection title="Computer lab" description="Only for computer labs.">
                  <Field
                    name="computerCount"
                    label="Computers"
                    type="number"
                    defaultValue={editing?.computerCount ?? ""}
                    min={0}
                  />
                  <Field
                    name="software"
                    label="Software (comma separated)"
                    defaultValue={editing?.softwareList.join(", ") ?? ""}
                    placeholder="MATLAB, Python, VS Code"
                  />
                </FormSection>
                <SelectField
                  name="responsiblePersonId"
                  label="Responsible"
                  defaultValue={editing?.responsiblePersonId ?? ""}
                  emptyLabel="(none)"
                >
                  {staff.map((s) => (
                    <option key={s.personId} value={s.personId}>
                      {s.person.fullName}
                    </option>
                  ))}
                </SelectField>
                {editing ? (
                  <SelectField name="status" label="Status" defaultValue={editing.status}>
                    <option value="available">available</option>
                    <option value="maintenance">maintenance</option>
                    <option value="retired">retired</option>
                  </SelectField>
                ) : null}
              </ActionForm>
            </CardContent>
          </Card>
        }
      >
        <ResourcesTable rows={rows} />
      </ListLayout>
    </div>
  );
}
