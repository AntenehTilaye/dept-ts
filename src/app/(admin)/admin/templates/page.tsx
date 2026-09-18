import { adminPageContext } from "@/lib/auth/page";
import { prismaRoot } from "@/lib/db/prisma";
import { listTemplates } from "@/platform/template/service";
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
import { createTemplateForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await adminPageContext();
  const [templates, departments] = await Promise.all([
    listTemplates(prismaRoot, null),
    prismaRoot.department.findMany({ orderBy: { code: "asc" } }),
  ]);
  const overrides = await prismaRoot.template.findMany({
    where: { departmentId: { not: null } },
    include: { versions: { orderBy: { version: "desc" } } },
    orderBy: { key: "asc" },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>
            Faculty templates and department overrides. Bodies are mustache with declared variables.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Versions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...templates, ...overrides].map((t) => (
                <TableRow key={t.id} data-testid={`template-${t.key}`}>
                  <TableCell>
                    <a className="font-mono underline" href={`/admin/templates/${t.id}`}>
                      {t.key}
                    </a>
                    {t.isSystem ? (
                      <Badge variant="secondary" className="ml-2">
                        system
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{t.kind}</TableCell>
                  <TableCell>{t.departmentId ?? "faculty"}</TableCell>
                  <TableCell className="flex gap-1">
                    {t.versions.map((v) => (
                      <Badge key={v.id} variant={v.status === "active" ? "default" : "secondary"}>
                        v{v.version}
                      </Badge>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>New template</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createTemplateForm}
            submitLabel="Create"
            successMessage="Template created."
            className="grid gap-2"
          >
            <Field name="key" label="Key" required placeholder="module.message_key" />
            <SelectField name="kind" label="Kind" required defaultValue="message">
              {["message", "reminder", "document", "report", "export_layout"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </SelectField>
            <SelectField name="departmentId" label="Scope" emptyLabel="faculty">
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} override
                </option>
              ))}
            </SelectField>
            <Field
              name="variables"
              label="Variables (name:required, ...)"
              defaultValue="recipient_name, subject_label, action_url"
            />
            <Field name="inApp" label="In-app text" />
            <Field name="emailSubject" label="Email subject" />
            <div className="grid gap-1">
              <label className="text-sm font-medium" htmlFor="emailBody-new">
                Email body
              </label>
              <textarea
                id="emailBody-new"
                name="emailBody"
                className="min-h-24 rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
