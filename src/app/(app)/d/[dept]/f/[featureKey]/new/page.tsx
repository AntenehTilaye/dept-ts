import { notFound } from "next/navigation";
import { dbOf, pageContext } from "@/lib/auth/page";
import { requireCan } from "@/lib/auth/require";
import { FeatureNotFoundError, getDefinition } from "@/platform/feature";
import { boundOptionsFor } from "@/platform/forms";
import { NewRecordForm } from "@/features/runtime/NewRecordForm";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NewRecordPage(props: PageProps<"/d/[dept]/f/[featureKey]/new">) {
  const { dept, featureKey } = await props.params;
  const search = await props.searchParams;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);

  let resolved;
  try {
    resolved = await getDefinition(db, ctx.departmentId, featureKey);
  } catch (error) {
    if (error instanceof FeatureNotFoundError) notFound();
    throw error;
  }
  await requireCan(ctx, `feature.${featureKey}.create`, undefined, "submit");

  const preset = Array.isArray(search.preset) ? search.preset[0] : search.preset;
  const parentType = Array.isArray(search.parentType) ? search.parentType[0] : search.parentType;
  const parentId = Array.isArray(search.parentId) ? search.parentId[0] : search.parentId;

  // the pickers of this form (who the task goes to, which record it hangs under, ...) get their
  // choices from the department's own data
  const boundOptions = await boundOptionsFor(resolved.def.record.fields, {
    db,
    departmentId: ctx.departmentId,
    personId: ctx.personId,
    subject: parentType && parentId ? { subjectType: parentType, subjectId: parentId } : null,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        crumbs={[
          { label: resolved.def.labels.plural, href: `/d/${dept}/f/${featureKey}` },
          { label: `New ${resolved.def.labels.singular.toLowerCase()}` },
        ]}
        title={`New ${resolved.def.labels.singular.toLowerCase()}`}
        description={resolved.def.description}
      />
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            These answers travel with the record; the steps that follow ask for the rest.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewRecordForm
            dept={dept}
            featureKey={featureKey}
            fields={resolved.def.record.fields}
            boundOptions={boundOptions}
            presets={Object.entries(resolved.def.presets).map(([key, p]) => ({
              key,
              label: p.label,
            }))}
            initialPreset={preset}
            parentRef={
              parentType && parentId ? { subjectType: parentType, subjectId: parentId } : undefined
            }
            submitLabel={`Create ${resolved.def.labels.singular.toLowerCase()}`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
