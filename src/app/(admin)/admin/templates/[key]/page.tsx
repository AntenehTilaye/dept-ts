import { notFound } from "next/navigation";
import { adminPageContext } from "@/lib/auth/page";
import { prismaRoot } from "@/lib/db/prisma";
import { fromJson } from "@/lib/db/json";
import {
  previewWithSample,
  type ChannelVariants,
  type Rendered,
} from "@/platform/template/service";
import type { DeclaredVariable } from "@/platform/template/mustache-safe";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { activateForm, newVersionForm } from "../actions";

export const dynamic = "force-dynamic";

export default async function TemplatePage(props: PageProps<"/admin/templates/[key]">) {
  await adminPageContext();
  const { key: id } = await props.params;
  const params = await props.searchParams;
  const t = await prismaRoot.template.findUnique({
    where: { id },
    include: { versions: { orderBy: { version: "desc" } } },
  });
  if (!t) notFound();
  const selected =
    t.versions.find((v) => String(v.version) === params.v) ??
    t.versions.find((v) => v.status === "active") ??
    t.versions[0]!;
  const variants = fromJson<ChannelVariants>(selected.channelVariantsJson);
  const declared = fromJson<DeclaredVariable[]>(selected.declaredVariablesJson);
  let preview: Rendered = {};
  let previewError: string | null = null;
  try {
    preview = previewWithSample(variants, declared);
  } catch (e) {
    previewError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">{t.key}</h1>
        <p className="text-sm text-muted-foreground">
          {t.kind} · {t.departmentId ?? "faculty"} · active version {t.activeVersion ?? "none"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {t.versions.map((v) => (
          <a key={v.id} href={`/admin/templates/${t.id}?v=${v.version}`}>
            <Badge variant={v.id === selected.id ? "default" : "secondary"}>
              v{v.version} {v.status}
            </Badge>
          </a>
        ))}
        {selected.status !== "active" ? (
          <ActionForm
            action={activateForm}
            submitLabel={`Activate v${selected.version}`}
            successMessage="Activated."
            className="inline"
          >
            <input type="hidden" name="templateId" value={t.id} />
            <input type="hidden" name="version" value={selected.version} />
          </ActionForm>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Version {selected.version}</CardTitle>
            <CardDescription className="flex flex-wrap gap-1">
              {declared.map((d) => (
                <Badge key={d.name} variant={d.required ? "default" : "outline"}>
                  {`{{${d.name}}}`}
                </Badge>
              ))}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {Object.entries(variants).map(([k, body]) =>
              body ? (
                <div key={k}>
                  <p className="text-xs font-medium uppercase text-muted-foreground">{k}</p>
                  <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs">
                    {body}
                  </pre>
                </div>
              ) : null,
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Preview with sample values</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm" data-testid="template-preview">
            {previewError ? <p className="text-destructive">{previewError}</p> : null}
            {Object.entries(preview).map(([k, body]) =>
              body ? (
                <div key={k}>
                  <p className="text-xs font-medium uppercase text-muted-foreground">{k}</p>
                  <pre className="whitespace-pre-wrap rounded-md border p-2 text-xs">{body}</pre>
                </div>
              ) : null,
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>New version</CardTitle>
          <CardDescription>
            Starts from the selected version. Every referenced variable must be declared.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={newVersionForm}
            submitLabel="Save new version"
            successMessage="Version saved."
            className="grid gap-2"
            resetOnSuccess={false}
          >
            <input type="hidden" name="templateId" value={t.id} />
            <Field
              name="variables"
              label="Variables (name:required, ...)"
              defaultValue={declared
                .map((d) => (d.required ? `${d.name}:required` : d.name))
                .join(", ")}
            />
            <Field name="inApp" label="In-app text" defaultValue={variants.inApp ?? ""} />
            <Field
              name="emailSubject"
              label="Email subject"
              defaultValue={variants.emailSubject ?? ""}
            />
            <div className="grid gap-1">
              <label className="text-sm font-medium" htmlFor="emailBody-edit">
                Email body
              </label>
              <textarea
                id="emailBody-edit"
                name="emailBody"
                className="min-h-32 rounded-md border px-3 py-2 font-mono text-xs"
                defaultValue={variants.emailBody ?? ""}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="activate" value="1" defaultChecked /> Activate
              immediately
            </label>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
