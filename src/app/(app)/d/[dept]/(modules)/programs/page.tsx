import { dbOf, pageContextCan } from "@/lib/auth/page";
import { listPrograms } from "@/platform/academic/courses";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { upsertProgramForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProgramsPage(props: PageProps<"/d/[dept]/programs">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContextCan(dept, "academic.manage");
  const programs = await listPrograms(dbOf(ctx), ctx.departmentId);
  const editing =
    typeof params.edit === "string" ? programs.find((p) => p.id === params.edit) : undefined;
  const counts = await dbOf(ctx).student.groupBy({ by: ["programId"], _count: { _all: true } });
  const countOf = new Map(counts.map((c) => [c.programId, c._count._all]));

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Programs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Degree</TableHead>
                <TableHead>Years</TableHead>
                <TableHead>Students</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {programs.map((p) => (
                <TableRow key={p.id} data-testid={`program-${p.code}`}>
                  <TableCell className="font-mono">{p.code}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{p.degreeLevel}</TableCell>
                  <TableCell>{p.durationYears}</TableCell>
                  <TableCell>{countOf.get(p.id) ?? 0}</TableCell>
                  <TableCell>
                    <a className="text-xs underline" href={`/d/${dept}/programs?edit=${p.id}`}>
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
          <CardTitle>{editing ? `Edit ${editing.code}` : "Add a program"}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={upsertProgramForm}
            submitLabel={editing ? "Save" : "Add program"}
            successMessage="Program saved."
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
              placeholder="BSC-CS"
            />
            <Field name="name" label="Name" required defaultValue={editing?.name} />
            <Field
              name="degreeLevel"
              label="Degree level"
              required
              defaultValue={editing?.degreeLevel ?? "BSc"}
            />
            <Field
              name="durationYears"
              label="Duration (years)"
              type="number"
              required
              defaultValue={editing?.durationYears ?? 4}
              min={1}
              max={8}
            />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
