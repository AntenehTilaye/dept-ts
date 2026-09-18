import { dbOf, pageContextCan } from "@/lib/auth/page";
import { listPrograms } from "@/platform/academic/courses";
import { representativesOf } from "@/platform/people/representatives";
import { studentsInSection } from "@/platform/people/students";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  addStudentToSectionForm,
  assignRepresentativeForm,
  createSectionForm,
  endRepresentativeForm,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function SectionsPage(props: PageProps<"/d/[dept]/sections">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContextCan(dept, "academic.manage");
  const db = dbOf(ctx);
  const years = await db.academicYear.findMany({
    where: { departmentId: ctx.departmentId },
    orderBy: { startDate: "desc" },
  });
  const yearId =
    typeof params.year === "string"
      ? params.year
      : (years.find((y) => y.status === "active")?.id ?? years[0]?.id);
  const [programs, sections] = await Promise.all([
    listPrograms(db, ctx.departmentId),
    db.section.findMany({
      where: { academicYearId: yearId },
      include: { program: true },
      orderBy: [{ program: { code: "asc" } }, { yearLevel: "asc" }, { code: "asc" }],
    }),
  ]);
  const detail = await Promise.all(
    sections.map(async (s) => ({
      section: s,
      students: await studentsInSection(db, s.id),
      reps: await representativesOf(db, s.id, s.academicYearId),
    })),
  );
  const unassigned = await db.student.findMany({
    where: {
      departmentId: ctx.departmentId,
      status: "active",
      sectionMemberships: { none: { academicYearId: yearId, validTo: null } },
    },
    include: { person: true },
    orderBy: { person: { fullName: "asc" } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Sections</h1>
        <form method="get" className="flex items-end gap-2">
          <SelectField name="year" label="Academic year" defaultValue={yearId}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.code} ({y.status})
              </option>
            ))}
          </SelectField>
          <button type="submit" className="h-9 rounded-md border px-3 text-sm">
            Show
          </button>
        </form>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {detail.map(({ section, students, reps }) => (
          <Card key={section.id} data-testid={`section-${section.code}`}>
            <CardHeader>
              <CardTitle>{section.code}</CardTitle>
              <CardDescription>
                {section.program.code} · year {section.yearLevel} · {students.length} students
                {section.capacity ? ` / ${section.capacity}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div data-testid="representatives">
                <p className="font-medium">Representatives</p>
                <ul className="flex flex-col gap-1">
                  {reps.map((r) => (
                    <li key={r.id} className="flex items-center justify-between">
                      <span>
                        {r.student.person.fullName}{" "}
                        {r.isPrimary ? (
                          <Badge>primary</Badge>
                        ) : (
                          <Badge variant="secondary">deputy</Badge>
                        )}
                      </span>
                      <ActionForm
                        action={endRepresentativeForm}
                        submitLabel="End"
                        successMessage="Ended."
                        className="inline"
                      >
                        <input type="hidden" name="dept" value={dept} />
                        <input type="hidden" name="representativeId" value={r.id} />
                      </ActionForm>
                    </li>
                  ))}
                  {reps.length === 0 ? <li className="text-muted-foreground">none</li> : null}
                </ul>
              </div>
              <ActionForm
                action={assignRepresentativeForm}
                submitLabel="Assign representative"
                successMessage="Representative assigned (invited when no login existed)."
                className="grid grid-cols-[2fr_1fr_auto] items-end gap-2"
              >
                <input type="hidden" name="dept" value={dept} />
                <input type="hidden" name="sectionId" value={section.id} />
                <SelectField name="studentId" label="Student" required>
                  {students.map((s) => (
                    <option key={s.personId} value={s.personId}>
                      {s.person.fullName}
                    </option>
                  ))}
                </SelectField>
                <SelectField name="isPrimary" label="Role" defaultValue="1">
                  <option value="1">primary</option>
                  <option value="0">deputy</option>
                </SelectField>
              </ActionForm>
              <details>
                <summary className="cursor-pointer">Students ({students.length})</summary>
                <ul className="mt-1 columns-2 text-xs">
                  {students.map((s) => (
                    <li key={s.personId}>{s.person.fullName}</li>
                  ))}
                </ul>
              </details>
              {unassigned.length ? (
                <ActionForm
                  action={addStudentToSectionForm}
                  submitLabel="Add"
                  successMessage="Student added."
                  className="grid grid-cols-[1fr_auto] items-end gap-2"
                >
                  <input type="hidden" name="dept" value={dept} />
                  <input type="hidden" name="sectionId" value={section.id} />
                  <SelectField name="studentId" label="Add a student without a section" required>
                    {unassigned.map((s) => (
                      <option key={s.personId} value={s.personId}>
                        {s.person.fullName}
                      </option>
                    ))}
                  </SelectField>
                </ActionForm>
              ) : null}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>Add a section</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createSectionForm}
              submitLabel="Add section"
              successMessage="Section created."
              className="grid gap-3"
            >
              <input type="hidden" name="dept" value={dept} />
              <input type="hidden" name="academicYearId" value={yearId ?? ""} />
              <SelectField name="programId" label="Program" required>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code}
                  </option>
                ))}
              </SelectField>
              <Field
                name="yearLevel"
                label="Year level"
                type="number"
                required
                defaultValue={1}
                min={1}
                max={8}
              />
              <Field name="code" label="Code" required placeholder="CS-Y1-A" />
              <Field name="capacity" label="Capacity" type="number" min={1} />
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
