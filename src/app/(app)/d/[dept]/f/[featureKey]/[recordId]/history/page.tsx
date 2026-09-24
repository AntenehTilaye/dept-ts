import { notFound } from "next/navigation";
import { dbOf, pageContext } from "@/lib/auth/page";
import { requireCan } from "@/lib/auth/require";
import { history } from "@/platform/audit/history";
import { definitionOfRecord } from "@/platform/feature";
import { AuditPanel } from "@/components/AuditPanel";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/** Everything that happened to one record: its transitions, its step entries and its audit rows. */
export default async function RecordHistoryPage(
  props: PageProps<"/d/[dept]/f/[featureKey]/[recordId]/history">,
) {
  const { dept, featureKey, recordId } = await props.params;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);

  const record = await db.featureRecord.findUnique({ where: { id: recordId } });
  if (!record) notFound();
  const resolved = await definitionOfRecord(db, record);
  if (resolved.key !== featureKey) notFound();
  await requireCan(
    ctx,
    `feature.${featureKey}.view`,
    { subjectType: "feature_record", subjectId: recordId },
    "read",
  );

  const [timeline, steps] = await Promise.all([
    history(db, { subjectType: "feature_record", subjectId: recordId }, 200),
    db.featureStepInstance.findMany({ where: { recordId }, orderBy: { enteredAt: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[
          { label: resolved.def.labels.plural, href: `/d/${dept}/f/${featureKey}` },
          { label: record.number, href: `/d/${dept}/f/${featureKey}/${recordId}` },
          { label: "History" },
        ]}
        title={`History of ${record.number}`}
        description={record.title}
      />

      <Card>
        <CardHeader>
          <CardTitle>Steps</CardTitle>
          <CardDescription>
            Every entry into a step, including the ones a revision loop repeated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {steps.map((step) => (
              <li key={step.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium">
                  {resolved.tree.byKey[step.stepKey]?.step.label ?? step.stepKey}
                  {step.branchKey ? ` · ${step.branchKey}` : ""}
                  {step.sequence > 1 ? ` (entry ${step.sequence})` : ""}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{step.status}</Badge>
                  {step.enteredAt.toISOString().slice(0, 16).replace("T", " ")}
                  {step.completedAt
                    ? ` → ${step.completedAt.toISOString().slice(0, 16).replace("T", " ")}`
                    : ""}
                  {step.outcomeActionKey ? ` · ${step.outcomeActionKey}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <AuditPanel entries={timeline} />
    </div>
  );
}
