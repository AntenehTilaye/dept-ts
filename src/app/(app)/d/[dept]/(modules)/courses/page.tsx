import { dbOf, pageContextCan } from "@/lib/auth/page";
import { courseLineage, listCourses, listPrograms } from "@/platform/academic/courses";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { ListLayout } from "@/components/patterns/ListLayout";
import { PageHeader } from "@/components/patterns/PageHeader";
import { CoursesTable } from "@/components/tables/SimpleTables";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { upsertCourseForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function CoursesPage(props: PageProps<"/d/[dept]/courses">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContextCan(dept, "academic.manage");
  const db = dbOf(ctx);
  const [courses, programs] = await Promise.all([
    listCourses(db, ctx.departmentId, { includeRetired: true }),
    listPrograms(db, ctx.departmentId),
  ]);
  const editing =
    typeof params.edit === "string" ? courses.find((c) => c.id === params.edit) : undefined;
  const lineage = editing ? await courseLineage(db, editing.id) : [];
  const rows = courses.map((c) => ({
    id: c.id,
    code: c.code,
    title: c.title,
    credits: c.creditHours.toString(),
    courseType: c.courseType,
    program: c.program?.code ?? "—",
    predecessor: c.predecessor?.code ?? "—",
    status: c.status,
    editHref: `/d/${dept}/courses?edit=${c.id}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Courses"
        description="The catalogue. A revised course names its predecessor so portfolios and CQI keep the history."
      />
      <ListLayout
        aside={
          <Card>
            <CardHeader>
              <CardTitle>{editing ? `Edit ${editing.code}` : "Add a course"}</CardTitle>
              <CardDescription>
                {lineage.length > 1 ? (
                  <>Lineage: {lineage.map((l) => l.code).join(" ← ")}. </>
                ) : null}
                {editing ? (
                  <a className="underline" href={`/d/${dept}/courses`}>
                    Cancel editing
                  </a>
                ) : (
                  "Codes are unique within the department."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={upsertCourseForm}
                submitLabel={editing ? "Save" : "Add course"}
                successMessage="Course saved."
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
                  placeholder="CS204"
                />
                <Field name="title" label="Title" required defaultValue={editing?.title} />
                <Field
                  name="creditHours"
                  label="Credit hours"
                  type="number"
                  step="0.5"
                  required
                  defaultValue={editing ? Number(editing.creditHours) : 3}
                />
                <SelectField
                  name="courseType"
                  label="Type"
                  required
                  defaultValue={editing?.courseType ?? "core"}
                >
                  <option value="core">core</option>
                  <option value="elective">elective</option>
                  <option value="common">common</option>
                </SelectField>
                <SelectField
                  name="programId"
                  label="Program"
                  defaultValue={editing?.programId ?? ""}
                  emptyLabel="(none)"
                >
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  name="predecessorCourseId"
                  label="Predecessor"
                  defaultValue={editing?.predecessorCourseId ?? ""}
                  emptyLabel="(none)"
                  hint="The course this one replaces; its offerings stay linked."
                >
                  {courses
                    .filter((c) => c.id !== editing?.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} {c.title}
                      </option>
                    ))}
                </SelectField>
                {editing ? (
                  <SelectField name="status" label="Status" defaultValue={editing.status}>
                    <option value="active">active</option>
                    <option value="retired">retired</option>
                  </SelectField>
                ) : null}
              </ActionForm>
            </CardContent>
          </Card>
        }
      >
        <CoursesTable rows={rows} />
      </ListLayout>
    </div>
  );
}
