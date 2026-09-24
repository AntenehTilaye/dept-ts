import { notFound } from "next/navigation";
import { dbOf, pageContext } from "@/lib/auth/page";
import { actorOf, requireCan } from "@/lib/auth/require";
import { availableActions, getStepContext } from "@/platform/feature";
import { answersOf } from "@/platform/forms/submissions";
import { fieldsOf } from "@/platform/forms/definitions";
import { StepForm } from "@/features/runtime/StepForm";
import { SubjectDocuments } from "@/components/documents/SubjectDocuments";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// One step of one record. The questions are the pinned form of that step, the buttons are the
// actions the definition offers, and the attachment slots are the deliverables it asks for.

export default async function StepPage(
  props: PageProps<"/d/[dept]/f/[featureKey]/[recordId]/steps/[stepKey]">,
) {
  const { dept, featureKey, recordId, stepKey } = await props.params;
  const search = await props.searchParams;
  const branch = Array.isArray(search.branch) ? search.branch[0] : search.branch;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);

  const context = await getStepContext(db, recordId, stepKey, branch ?? null).catch(() => null);
  if (!context || context.resolved.key !== featureKey) notFound();
  await requireCan(
    ctx,
    `feature.${featureKey}.view`,
    { subjectType: "feature_record", subjectId: recordId },
    "read",
  );

  const { record, resolved, step, instance, submission } = context;
  const compiledForm = resolved.compiled.forms[stepKey];
  const fields = compiledForm
    ? compiledForm.fields
    : submission
      ? fieldsOf(await db.formDefinition.findUniqueOrThrow({
          where: { id: submission.formDefinitionId },
          include: { questions: { orderBy: { order: "asc" } } },
        }))
      : [];
  const answers = submission ? answersOf(submission.answers, fields) : {};

  const actions = (await availableActions(db, recordId, actorOf(ctx)))
    .filter((action) => action.stepKey === stepKey && (!branch || action.branchKey === branch))
    .map((action) => ({
      key: action.key,
      label: action.label,
      kind: action.kind,
      requiresComment: action.requiresComment,
      allowed: action.allowed,
      reason: action.reason,
      confirm: action.confirm,
    }));

  const readOnly = !instance || instance.status !== "active" || !actions.some((a) => a.allowed);
  const stepSubject = instance
    ? { subjectType: "feature_step_instance", subjectId: instance.id }
    : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        crumbs={[
          { label: resolved.def.labels.plural, href: `/d/${dept}/f/${featureKey}` },
          { label: record.number, href: `/d/${dept}/f/${featureKey}/${recordId}` },
          { label: step.label },
        ]}
        title={step.label}
        description={step.description ?? resolved.def.labels.singular}
      />

      <Card>
        <CardHeader>
          <CardTitle>{step.form?.sectionTitle ?? step.label}</CardTitle>
          <CardDescription>
            {instance?.deadlineAt
              ? `Due ${instance.deadlineAt.toISOString().slice(0, 10)}.`
              : "No deadline for this step."}
            {readOnly ? " You are looking at it, not working on it." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StepForm
            dept={dept}
            featureKey={featureKey}
            recordId={recordId}
            stepKey={stepKey}
            branchKey={branch}
            fields={fields}
            initialAnswers={answers}
            actions={actions}
            readOnly={readOnly}
          />
        </CardContent>
      </Card>

      {step.attachments.length && stepSubject ? (
        <SubjectDocuments
          ctx={ctx}
          db={db}
          subject={stepSubject}
          linkRole="evidence"
          path={`/d/${dept}/f/${featureKey}/${recordId}/steps/${stepKey}`}
          emptyHint={`This step asks for: ${step.attachments.map((s) => s.label).join(", ")}.`}
        />
      ) : null}
    </div>
  );
}
