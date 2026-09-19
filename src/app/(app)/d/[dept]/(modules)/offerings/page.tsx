import { dbOf, pageContextCan } from "@/lib/auth/page";
import { listOfferings } from "@/platform/academic/offerings";
import { listCourses } from "@/platform/academic/courses";
import { listStaff } from "@/platform/people/staff";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField } from "@/components/forms/Field";
import { ListLayout } from "@/components/patterns/ListLayout";
import { PageHeader } from "@/components/patterns/PageHeader";
import { OfferingsTable } from "@/components/tables/SimpleTables";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  const rows = offerings.map((o) => ({
    id: o.id,
    code: o.course.code,
    title: o.course.title,
    coordinator: o.coordinator?.fullName ?? "—",
    sections: o._count.sectionOfferings,
    href: `/d/${dept}/offerings/${o.id}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Course offerings"
        description="Which courses run in a term, who coordinates them and which sections take them."
      />
      <ListLayout
        aside={
          <Card>
            <CardHeader>
              <CardTitle>Offer a course</CardTitle>
              <CardDescription>
                Sections and instructors are added on the offering page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={createOfferingForm}
                submitLabel="Create offering"
                successMessage="Offering created."
                className="grid gap-4"
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
        }
      >
        <Card>
          <CardHeader>
            <form method="get" className="flex flex-wrap items-end gap-2">
              <SelectField name="term" label="Term" defaultValue={termId}>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.academicYear.code} · {t.name} ({t.status})
                  </option>
                ))}
              </SelectField>
              <Button type="submit" variant="outline">
                Show
              </Button>
            </form>
          </CardHeader>
          <CardContent>
            <OfferingsTable rows={rows} />
          </CardContent>
        </Card>
      </ListLayout>
    </div>
  );
}
