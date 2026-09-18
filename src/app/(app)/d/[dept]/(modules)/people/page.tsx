import { canDo } from "@/lib/auth/require";
import { dbOf, pageContextCan } from "@/lib/auth/page";
import { searchPersons } from "@/platform/people/persons";
import { listPrograms } from "@/platform/academic/courses";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            Everyone linked to this department; search by name or email.
          </CardDescription>
          <form method="get" className="flex items-end gap-2">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search name or email"
              aria-label="Search"
              className="max-w-xs"
            />
            <SelectField name="type" label="Type" defaultValue={type ?? ""} emptyLabel="all">
              <option value="staff">staff</option>
              <option value="student">student</option>
              <option value="external">external</option>
            </SelectField>
            <button type="submit" className="h-9 rounded-md border px-3 text-sm">
              Search
            </button>
          </form>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {persons.map((p) => (
                <TableRow key={p.id} data-testid={`person-${p.email ?? p.id}`}>
                  <TableCell>
                    <a className="underline" href={`/d/${dept}/people/${p.id}`}>
                      {p.fullName}
                    </a>
                    {staffIds.has(p.id) ? (
                      <Badge variant="secondary" className="ml-2">
                        staff
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{p.email ?? "-"}</TableCell>
                  <TableCell>{p.type}</TableCell>
                  <TableCell>{p.status}</TableCell>
                </TableRow>
              ))}
              {persons.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No one matches.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {canManage ? (
        <Card>
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
              className="grid gap-3"
            >
              <input type="hidden" name="dept" value={dept} />
              <Field name="fullName" label="Full name" required />
              <Field name="email" label="Email" type="email" />
              <Field name="phone" label="Phone" />
              <SelectField name="type" label="Type" required defaultValue="staff">
                <option value="staff">staff</option>
                <option value="student">student</option>
                <option value="external">external</option>
              </SelectField>
              <Field name="staffId" label="Staff id (staff)" />
              <Field name="academicRank" label="Academic rank (staff)" />
              <Field name="studentNumber" label="Student number (student)" />
              <SelectField name="programId" label="Program (student)" emptyLabel="(none)">
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code}
                  </option>
                ))}
              </SelectField>
              <Field
                name="admissionYear"
                label="Admission year (student)"
                type="number"
                min={1990}
                max={2100}
              />
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
