import { dbOf, pageContextCan } from "@/lib/auth/page";
import { courseLineage, listCourses, listPrograms } from "@/platform/academic/courses";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Courses</CardTitle>
          <CardDescription>
            A revised course names its predecessor so portfolios and CQI keep the history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Program</TableHead>
                <TableHead>Predecessor</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map((c) => (
                <TableRow key={c.id} data-testid={`course-${c.code}`}>
                  <TableCell className="font-mono">
                    {c.code}{" "}
                    {c.status === "retired" ? <Badge variant="secondary">retired</Badge> : null}
                  </TableCell>
                  <TableCell>{c.title}</TableCell>
                  <TableCell>{c.creditHours.toString()}</TableCell>
                  <TableCell>{c.courseType}</TableCell>
                  <TableCell>{c.program?.code ?? "-"}</TableCell>
                  <TableCell className="font-mono">{c.predecessor?.code ?? "-"}</TableCell>
                  <TableCell>
                    <a className="text-xs underline" href={`/d/${dept}/courses?edit=${c.id}`}>
                      edit
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{editing ? `Edit ${editing.code}` : "Add a course"}</CardTitle>
          {lineage.length > 1 ? (
            <CardDescription>Lineage: {lineage.map((l) => l.code).join(" ← ")}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <ActionForm
            action={upsertCourseForm}
            submitLabel={editing ? "Save" : "Add course"}
            successMessage="Course saved."
            className="grid gap-3"
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
    </div>
  );
}
