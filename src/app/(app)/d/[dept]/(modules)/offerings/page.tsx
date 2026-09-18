import { dbOf, pageContextCan } from "@/lib/auth/page";
import { listOfferings } from "@/platform/academic/offerings";
import { listCourses } from "@/platform/academic/courses";
import { listStaff } from "@/platform/people/staff";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField } from "@/components/forms/Field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createOfferingForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function OfferingsPage(props: PageProps<"/d/[dept]/offerings">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContextCan(dept, "academic.manage");
  const db = dbOf(ctx);
  const terms = await db.term.findMany({
    where: { departmentId: ctx.departmentId },
    include: { academicYear: true },
    orderBy: { startDate: "desc" },
  });
  const termId =
    typeof params.term === "string"
      ? params.term
      : (terms.find((t) => t.status === "current")?.id ?? terms[0]?.id);
  const [offerings, courses, staff] = await Promise.all([
    listOfferings(db, ctx.departmentId, termId),
    listCourses(db, ctx.departmentId),
    listStaff(db, ctx.departmentId),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Course offerings</CardTitle>
          <form method="get" className="flex items-end gap-2">
            <SelectField name="term" label="Term" defaultValue={termId}>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.academicYear.code} · {t.name} ({t.status})
                </option>
              ))}
            </SelectField>
            <button type="submit" className="h-9 rounded-md border px-3 text-sm">
              Show
            </button>
          </form>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Course</TableHead>
                <TableHead>Coordinator</TableHead>
                <TableHead>Sections</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {offerings.map((o) => (
                <TableRow key={o.id} data-testid={`offering-${o.course.code}`}>
                  <TableCell>
                    <a className="underline" href={`/d/${dept}/offerings/${o.id}`}>
                      <span className="font-mono">{o.course.code}</span> {o.course.title}
                    </a>
                  </TableCell>
                  <TableCell>{o.coordinator?.fullName ?? "-"}</TableCell>
                  <TableCell>{o._count.sectionOfferings}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Offer a course</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createOfferingForm}
            submitLabel="Create offering"
            successMessage="Offering created."
            className="grid gap-3"
          >
            <input type="hidden" name="dept" value={dept} />
            <SelectField name="termId" label="Term" required defaultValue={termId}>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.academicYear.code} · {t.name}
                </option>
              ))}
            </SelectField>
            <SelectField name="courseId" label="Course" required>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.title}
                </option>
              ))}
            </SelectField>
            <SelectField name="coordinatorPersonId" label="Coordinator" emptyLabel="(none)">
              {staff.map((s) => (
                <option key={s.personId} value={s.personId}>
                  {s.person.fullName}
                </option>
              ))}
            </SelectField>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
