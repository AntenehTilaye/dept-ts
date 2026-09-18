import { dbOf, pageContextCan } from "@/lib/auth/page";
import { listResources } from "@/platform/academic/resources";
import { listStaff } from "@/platform/people/staff";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { upsertResourceForm } from "./actions";

export const dynamic = "force-dynamic";

const KINDS = [
  "classroom",
  "computer_lab",
  "meeting_room",
  "office",
  "exam_hall",
  "other",
] as const;

export default async function ResourcesPage(props: PageProps<"/d/[dept]/resources">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContextCan(dept, "academic.manage");
  const db = dbOf(ctx);
  const [resources, staff] = await Promise.all([
    listResources(db, ctx.departmentId),
    listStaff(db, ctx.departmentId),
  ]);
  const editing =
    typeof params.edit === "string" ? resources.find((r) => r.id === params.edit) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Rooms, labs and halls</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Responsible</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {resources.map((r) => (
                <TableRow key={r.id} data-testid={`resource-${r.code}`}>
                  <TableCell className="font-mono">{r.code}</TableCell>
                  <TableCell>
                    {r.name}
                    {r.kind === "computer_lab" ? (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {r.computerCount ?? 0} PCs · {r.softwareList.join(", ")}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{r.kind}</TableCell>
                  <TableCell>{r.capacity ?? "-"}</TableCell>
                  <TableCell>{r.responsible?.fullName ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "available" ? "default" : "secondary"}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <a className="text-xs underline" href={`/d/${dept}/resources?edit=${r.id}`}>
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
          <CardTitle>{editing ? `Edit ${editing.code}` : "Add a resource"}</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={upsertResourceForm}
            submitLabel={editing ? "Save" : "Add resource"}
            successMessage="Resource saved."
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
              placeholder="R102"
            />
            <Field name="name" label="Name" required defaultValue={editing?.name} />
            <SelectField
              name="kind"
              label="Kind"
              required
              defaultValue={editing?.kind ?? "classroom"}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </SelectField>
            <Field name="building" label="Building" defaultValue={editing?.building ?? ""} />
            <Field name="location" label="Location" defaultValue={editing?.location ?? ""} />
            <Field
              name="capacity"
              label="Capacity"
              type="number"
              defaultValue={editing?.capacity ?? ""}
              min={1}
            />
            <Field
              name="computerCount"
              label="Computers"
              type="number"
              defaultValue={editing?.computerCount ?? ""}
              min={0}
            />
            <Field
              name="software"
              label="Software (comma separated)"
              defaultValue={editing?.softwareList.join(", ") ?? ""}
            />
            <SelectField
              name="responsiblePersonId"
              label="Responsible"
              defaultValue={editing?.responsiblePersonId ?? ""}
              emptyLabel="(none)"
            >
              {staff.map((s) => (
                <option key={s.personId} value={s.personId}>
                  {s.person.fullName}
                </option>
              ))}
            </SelectField>
            {editing ? (
              <SelectField name="status" label="Status" defaultValue={editing.status}>
                <option value="available">available</option>
                <option value="maintenance">maintenance</option>
                <option value="retired">retired</option>
              </SelectField>
            ) : null}
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
