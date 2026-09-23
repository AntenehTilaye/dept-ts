import { notFound } from "next/navigation";
import { adminPageContext } from "@/lib/auth/page";
import { withTenantBypass } from "@/lib/db/tenant";
import { fieldsOf } from "@/platform/forms/definitions";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { JsonField } from "@/components/forms/JsonField";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormPreview } from "./FormPreview";
import { newFormVersionForm, publishFormForm } from "../actions";

export const dynamic = "force-dynamic";

/** One form: its versions, the questions of the selected version, a live preview and the editor. */
export default async function FormPage(props: PageProps<"/admin/forms/[formId]">) {
  const ctx = await adminPageContext();
  const { formId } = await props.params;
  // SHARED table: a department form is only readable under a bypass (see the list page).
  const bypass = { isAdmin: true as const, user: { id: ctx.user.id } };
  const form = await withTenantBypass(bypass, `read form ${formId}`, (tx) =>
    tx.formDefinition.findUnique({
      where: { id: formId },
      include: { questions: { orderBy: { order: "asc" } } },
    }),
  );
  if (!form) notFound();
  const versions = await withTenantBypass(bypass, `versions of form ${form.key}`, (tx) =>
    tx.formDefinition.findMany({
      where: { key: form.key, departmentId: form.departmentId },
      orderBy: { version: "desc" },
      select: { id: true, version: true, status: true },
    }),
  );
  const fields = fieldsOf(form);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: "Forms", href: "/admin/forms" }, { label: form.key }]}
        title={<span className="font-mono">{form.key}</span>}
        description={
          <>
            {form.title} · {form.kind} · {form.departmentId ?? "faculty"} · v{form.version}{" "}
            {form.status}
            {form.isSystem ? " · system form" : ""}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {versions.map((v) => (
              <a key={v.id} href={`/admin/forms/${v.id}`}>
                <Badge variant={v.id === form.id ? "default" : "secondary"}>
                  v{v.version} {v.status}
                </Badge>
              </a>
            ))}
            {form.status !== "published" ? (
              <ActionForm
                action={publishFormForm}
                submitLabel={`Publish v${form.version}`}
                successMessage="Published."
                className="inline"
                variant="outline"
                size="sm"
              >
                <input type="hidden" name="formId" value={form.id} />
              </ActionForm>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Questions</CardTitle>
            <CardDescription>
              {fields.length} question{fields.length === 1 ? "" : "s"} · hash{" "}
              <span className="font-mono text-xs">{form.questionsHash.slice(0, 12)}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="question-list">
              {fields.map((f) => (
                <li key={f.key} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{f.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{f.key}</span> · {f.type}
                      {f.constraints?.required ? " · required" : ""}
                      {f.aggregation && f.aggregation !== "none" ? ` · ${f.aggregation}` : ""}
                    </p>
                  </div>
                  {f.locked ? <Badge variant="outline">locked</Badge> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>Exactly what a respondent sees; nothing is stored.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormPreview fields={fields} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New version</CardTitle>
          <CardDescription>
            A version is only created when the questions change. Locked questions of a system form
            cannot be removed or retyped.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={newFormVersionForm}
            submitLabel="Save new version"
            successMessage="Version saved."
            className="grid gap-4"
            resetOnSuccess={false}
          >
            <input type="hidden" name="key" value={form.key} />
            <input type="hidden" name="departmentId" value={form.departmentId ?? ""} />
            <Field name="title" label="Title" defaultValue={form.title} />
            <JsonField
              name="fields"
              label="Questions (JSON)"
              rows={16}
              required
              initialValue={JSON.stringify(fields, null, 2)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="publish" value="1" defaultChecked /> Publish immediately
            </label>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
