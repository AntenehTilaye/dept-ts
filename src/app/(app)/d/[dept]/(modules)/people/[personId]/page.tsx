import { notFound } from "next/navigation";
import { canDo } from "@/lib/auth/require";
import { dbOf, pageContextCan } from "@/lib/auth/page";
import { groupsOf } from "@/platform/people/groups";
import { getStaffProfile, profileItemsOf } from "@/platform/people/staff";
import { getStudent, currentSectionMembership } from "@/platform/people/students";
import { teachingOf } from "@/platform/academic/teaching";
import { ActionForm } from "@/components/forms/ActionForm";
import { AuditPanel } from "@/components/AuditPanel";
import { SubjectDocuments } from "@/components/documents/SubjectDocuments";
import { SubjectThread } from "@/components/thread/SubjectThread";
import { history } from "@/platform/audit/history";
import { Field, SelectField, fmtDate } from "@/components/forms/Field";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addProfileItemForm, renamePersonForm } from "../actions";

export const dynamic = "force-dynamic";

const ITEM_KINDS = [
  "qualification",
  "publication",
  "research_activity",
  "training",
  "certification",
  "work_experience",
  "responsibility",
] as const;

export default async function PersonPage(props: PageProps<"/d/[dept]/people/[personId]">) {
  const { dept, personId } = await props.params;
  const ctx = await pageContextCan(dept, "staff.view");
  const db = dbOf(ctx);
  const link = await db.departmentPerson.findUnique({
    where: { departmentId_personId: { departmentId: ctx.departmentId, personId } },
    include: { person: true },
  });
  if (!link) notFound();
  const person = link.person;
  const [staff, student, groups, teaching, items] = await Promise.all([
    getStaffProfile(db, personId),
    getStudent(db, personId),
    groupsOf(db, personId),
    teachingOf(db, personId),
    profileItemsOf(db, personId),
  ]);
  const membership = student
    ? await currentSectionMembership(
        db,
        personId,
        (
          await db.academicYear.findFirst({
            where: { departmentId: ctx.departmentId, status: "active" },
          })
        )?.id ?? "",
        new Date(),
      )
    : null;
  const canManage = (await canDo(ctx, "staff.manage")).allowed || ctx.personId === personId;
  const canEditPerson = (await canDo(ctx, "staff.manage")).allowed;
  const timeline = canEditPerson
    ? await history(db, { subjectType: "person", subjectId: personId }, 30)
    : [];
  const subject = { subjectType: "person", subjectId: personId };
  const path = `/d/${dept}/people/${personId}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: "People", href: `/d/${dept}/people` }, { label: person.fullName }]}
        title={person.fullName}
        description={
          <>
            {person.email ?? "no email"} · {person.type} · {person.status}
            {person.userId ? " · has login" : " · no login"}
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {staff ? (
          <Card data-testid="staff-profile">
            <CardHeader>
              <CardTitle>Staff profile</CardTitle>
              <CardDescription>
                {staff.staffId} · {staff.academicRank ?? "-"} · {staff.employmentType ?? "-"}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              <p>Specialization: {staff.specialization ?? "-"}</p>
              <p>Interests: {staff.academicInterests.join(", ") || "-"}</p>
              <p>
                Office: {staff.officeLocation ?? "-"} · {staff.officeHoursText ?? "-"}
              </p>
              <p>Joined: {fmtDate(staff.joinedAt) || "-"}</p>
            </CardContent>
          </Card>
        ) : null}
        {student ? (
          <Card data-testid="student-profile">
            <CardHeader>
              <CardTitle>Student</CardTitle>
              <CardDescription>
                {student.studentNumber} · {student.program.code} · admitted {student.admissionYear}{" "}
                · {student.status}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              Section: {membership?.section.code ?? "-"}
            </CardContent>
          </Card>
        ) : null}
        <Card data-testid="groups">
          <CardHeader>
            <CardTitle>Groups</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            {groups.map((g) => (
              <Badge key={g.id} variant="secondary">
                {g.group.name} ({g.roleInGroup})
              </Badge>
            ))}
            {groups.length === 0 ? <span className="text-muted-foreground">none</span> : null}
          </CardContent>
        </Card>
        <Card data-testid="teaching">
          <CardHeader>
            <CardTitle>Teaching</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {teaching.map((t) => (
                <li key={t.id}>
                  <a
                    className="underline"
                    href={`/d/${dept}/offerings/${t.sectionOffering.courseOfferingId}`}
                  >
                    {t.sectionOffering.courseOffering.course.code} {t.sectionOffering.sectionCode}
                  </a>{" "}
                  <span className="text-muted-foreground">
                    {t.role} · {t.sectionOffering.courseOffering.term.name}
                  </span>
                </li>
              ))}
              {teaching.length === 0 ? <li className="text-muted-foreground">none</li> : null}
            </ul>
          </CardContent>
        </Card>
        {canEditPerson ? (
          <Card data-testid="edit-person">
            <CardHeader>
              <CardTitle>Edit person</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={renamePersonForm}
                submitLabel="Save person"
                successMessage="Person saved."
                className="grid gap-2"
                resetOnSuccess={false}
              >
                <input type="hidden" name="dept" value={dept} />
                <input type="hidden" name="personId" value={personId} />
                <Field name="fullName" label="Full name" required defaultValue={person.fullName} />
                <Field name="phone" label="Phone" defaultValue={person.phone ?? ""} />
              </ActionForm>
            </CardContent>
          </Card>
        ) : null}
        <Card data-testid="profile-items">
          <CardHeader>
            <CardTitle>Profile items</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1 text-sm">
              {items.map((i) => (
                <li key={i.id}>
                  <span className="font-mono text-xs">{i.kind}</span> {i.title}
                  {i.institutionOrVenue ? ` · ${i.institutionOrVenue}` : ""}
                  {i.dateFrom || i.dateTo
                    ? ` (${fmtDate(i.dateFrom)}${i.dateTo ? ` – ${fmtDate(i.dateTo)}` : ""})`
                    : ""}
                </li>
              ))}
              {items.length === 0 ? <li className="text-muted-foreground">none</li> : null}
            </ul>
            {canManage ? (
              <ActionForm
                action={addProfileItemForm}
                submitLabel="Add item"
                successMessage="Item added."
                className="grid gap-2"
              >
                <input type="hidden" name="dept" value={dept} />
                <input type="hidden" name="personId" value={personId} />
                <SelectField name="kind" label="Kind" required defaultValue="qualification">
                  {ITEM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </SelectField>
                <Field name="title" label="Title" required />
                <Field name="institutionOrVenue" label="Institution / venue" />
                <div className="grid grid-cols-2 gap-2">
                  <Field name="dateFrom" label="From" type="date" />
                  <Field name="dateTo" label="To" type="date" />
                </div>
              </ActionForm>
            ) : null}
          </CardContent>
        </Card>
        {canEditPerson ? (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <AuditPanel entries={timeline} />
            </CardContent>
          </Card>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="person-documents">
          <CardHeader>
            <CardTitle>Documents</CardTitle>
            <CardDescription>
              Certificates, CVs and other evidence, versioned. Files are only visible inside{" "}
              {ctx.departmentName}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SubjectDocuments ctx={ctx} db={db} subject={subject} linkRole="evidence" path={path} />
          </CardContent>
        </Card>
        <Card data-testid="person-discussion">
          <CardHeader>
            <CardTitle>Discussion</CardTitle>
            <CardDescription>
              Notes between the person and the department leadership; @mention to notify.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SubjectThread ctx={ctx} db={db} subject={subject} path={path} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
