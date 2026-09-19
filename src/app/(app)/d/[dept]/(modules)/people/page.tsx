import { SearchIcon } from "lucide-react";
import { canDo } from "@/lib/auth/require";
import { dbOf, pageContextCan } from "@/lib/auth/page";
import { searchPersons } from "@/platform/people/persons";
import { listPrograms } from "@/platform/academic/courses";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { FormSection } from "@/components/patterns/FormSection";
import { ListLayout } from "@/components/patterns/ListLayout";
import { PageHeader } from "@/components/patterns/PageHeader";
import { PeopleTable } from "@/components/tables/PeopleTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createPersonForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function PeoplePage(props: PageProps<"/d/[dept]/people">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContextCan(dept, "staff.view");
  const db = dbOf(ctx);
  const q = typeof params.q === "string" ? params.q : "";
  const type =
    params.type === "staff" || params.type === "student" || params.type === "external"
      ? params.type
      : undefined;
  const persons = await searchPersons(db, ctx.departmentId, { q, type });
  const staffIds = new Set(
    (
      await db.staffProfile.findMany({
        where: { personId: { in: persons.map((p) => p.id) } },
        select: { personId: true },
      })
    ).map((s) => s.personId),
  );
  const canManage = (await canDo(ctx, "staff.manage")).allowed;
  const programs = canManage ? await listPrograms(db, ctx.departmentId) : [];
  const rows = persons.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    email: p.email,
    type: p.type,
    status: p.status,
    isStaff: staffIds.has(p.id),
    href: `/d/${dept}/people/${p.id}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="People"
        description="Everyone linked to this department: staff, students and external contacts."
      />
      <ListLayout
        aside={
          canManage ? (
            <Card id="add-person">
              <CardHeader>
                <CardTitle>Add a person</CardTitle>
                <CardDescription>
                  An existing email links the same faculty-wide person to this department.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ActionForm
                  action={createPersonForm}
                  submitLabel="Add person"
                  successMessage="Person added."
                  className="grid gap-4"
                >
                  <input type="hidden" name="dept" value={dept} />
                  <Field name="fullName" label="Full name" required autoComplete="off" />
                  <Field name="email" label="Email" type="email" autoComplete="off" />
                  <Field name="phone" label="Phone" />
                  <SelectField name="type" label="Type" required defaultValue="staff">
                    <option value="staff">staff</option>
                    <option value="student">student</option>
                    <option value="external">external</option>
                  </SelectField>
                  <FormSection title="Staff details" description="Only for staff.">
                    <Field name="staffId" label="Staff id" />
                    <Field name="academicRank" label="Academic rank" />
                  </FormSection>
                  <FormSection title="Student details" description="Only for students.">
                    <Field name="studentNumber" label="Student number" />
                    <SelectField name="programId" label="Program" emptyLabel="(none)">
                      {programs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code}
                        </option>
                      ))}
                    </SelectField>
                    <Field
                      name="admissionYear"
                      label="Admission year"
                      type="number"
                      min={1990}
                      max={2100}
                    />
                  </FormSection>
                </ActionForm>
              </CardContent>
            </Card>
          ) : undefined
        }
      >
        <Card>
          <CardHeader>
            <form method="get" className="flex flex-wrap items-end gap-2" role="search">
              <div className="grid gap-1.5">
                <label htmlFor="people-q" className="text-sm font-medium">
                  Search
                </label>
                <Input
                  id="people-q"
                  name="q"
                  defaultValue={q}
                  placeholder="Name or email"
                  className="w-56"
                />
              </div>
              <SelectField name="type" label="Type" defaultValue={type ?? ""} emptyLabel="all">
                <option value="staff">staff</option>
                <option value="student">student</option>
                <option value="external">external</option>
              </SelectField>
              <Button type="submit" variant="outline">
                <SearchIcon /> Search
              </Button>
            </form>
          </CardHeader>
          <CardContent>
            <PeopleTable rows={rows} canManage={canManage} />
          </CardContent>
        </Card>
      </ListLayout>
    </div>
  );
}
