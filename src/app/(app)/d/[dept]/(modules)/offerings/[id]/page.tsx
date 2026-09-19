import { notFound } from "next/navigation";
import { dbOf, pageContextCan } from "@/lib/auth/page";
import { getOffering } from "@/platform/academic/offerings";
import { listStaff } from "@/platform/people/staff";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField } from "@/components/forms/Field";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  addSectionOfferingForm,
  assignTeachingForm,
  endTeachingForm,
  enrollMembersForm,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function OfferingPage(props: PageProps<"/d/[dept]/offerings/[id]">) {
  const { dept, id } = await props.params;
  const ctx = await pageContextCan(dept, "academic.manage");
  const db = dbOf(ctx);
  const offering = await getOffering(db, id);
  if (!offering) notFound();
  const [sections, staff] = await Promise.all([
    db.section.findMany({
      where: { academicYearId: offering.term.academicYearId },
      include: { program: true },
      orderBy: { code: "asc" },
    }),
    listStaff(db, ctx.departmentId),
  ]);
  const used = new Set(offering.sectionOfferings.map((s) => s.sectionId));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[
          { label: "Offerings", href: `/d/${dept}/offerings` },
          { label: offering.course.code },
        ]}
        title={
          <>
            <span className="font-mono">{offering.course.code}</span> {offering.course.title}
          </>
        }
        description={
          <>
            {offering.term.academicYear.code} · {offering.term.name} · coordinator{" "}
            {offering.coordinator?.fullName ?? "—"}
            {offering.schemeStructureLockedAt ? " · scheme locked" : ""}
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {offering.sectionOfferings.map((so) => (
          <Card key={so.id} data-testid={`section-offering-${so.sectionCode}`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {so.sectionCode}{" "}
                {so.assessmentLockedAt ? (
                  <Badge variant="secondary">assessment locked</Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {so.enrolledCount} enrolled · {so._count.enrollments} roster rows ·{" "}
                {so.section.program.code} year {so.section.yearLevel}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col gap-1 text-sm" data-testid="teaching-list">
                {so.teachingAssignments.map((ta) => (
                  <li key={ta.id} className="flex items-center justify-between">
                    <span>
                      {ta.person.fullName}{" "}
                      <span className="text-muted-foreground">({ta.role})</span>
                    </span>
                    <ActionForm
                      action={endTeachingForm}
                      submitLabel="End"
                      successMessage="Ended."
                      className="inline"
                    >
                      <input type="hidden" name="dept" value={dept} />
                      <input type="hidden" name="courseOfferingId" value={offering.id} />
                      <input type="hidden" name="teachingAssignmentId" value={ta.id} />
                    </ActionForm>
                  </li>
                ))}
                {so.teachingAssignments.length === 0 ? (
                  <li className="text-muted-foreground">No instructor yet.</li>
                ) : null}
              </ul>
              <ActionForm
                action={assignTeachingForm}
                submitLabel="Assign"
                successMessage="Assigned."
                className="grid grid-cols-[2fr_1fr_auto] items-end gap-2"
              >
                <input type="hidden" name="dept" value={dept} />
                <input type="hidden" name="courseOfferingId" value={offering.id} />
                <input type="hidden" name="sectionOfferingId" value={so.id} />
                <SelectField name="personId" label="Instructor" required>
                  {staff.map((s) => (
                    <option key={s.personId} value={s.personId}>
                      {s.person.fullName}
                    </option>
                  ))}
                </SelectField>
                <SelectField name="role" label="Role" required defaultValue="lecture">
                  <option value="lecture">lecture</option>
                  <option value="lab">lab</option>
                  <option value="tutorial">tutorial</option>
                  <option value="coordinator">coordinator</option>
                </SelectField>
              </ActionForm>
              <ActionForm
                action={enrollMembersForm}
                submitLabel="Enroll section members"
                successMessage="Roster updated."
                className="inline"
              >
                <input type="hidden" name="dept" value={dept} />
                <input type="hidden" name="courseOfferingId" value={offering.id} />
                <input type="hidden" name="sectionOfferingId" value={so.id} />
              </ActionForm>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>Add a section</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={addSectionOfferingForm}
              submitLabel="Add section"
              successMessage="Section added."
              className="grid gap-3"
            >
              <input type="hidden" name="dept" value={dept} />
              <input type="hidden" name="courseOfferingId" value={offering.id} />
              <SelectField name="sectionId" label="Section" required>
                {sections
                  .filter((s) => !used.has(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} ({s.program.code} Y{s.yearLevel})
                    </option>
                  ))}
              </SelectField>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="enroll" value="1" defaultChecked /> Enroll current
                section members
              </label>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
