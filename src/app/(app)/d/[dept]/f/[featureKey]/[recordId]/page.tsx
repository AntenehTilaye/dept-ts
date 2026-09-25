import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { dbOf, pageContext } from "@/lib/auth/page";
import { actorOf, requireCan } from "@/lib/auth/require";
import { history } from "@/platform/audit/history";
import { featureRecord } from "@/features/runtime/queries";
import { FeatureRecordShell } from "@/features/runtime/FeatureRecordShell";
import { SubjectDocuments } from "@/components/documents/SubjectDocuments";
import { SubjectThread } from "@/components/thread/SubjectThread";
import { registerRecordSurfaces } from "@/modules/record-surfaces";
import { surfaceFor } from "@/modules/surfaces";
import { TaskActionsPanel } from "@/modules/tasks/TaskActionsPanel";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

// One record of any feature. Everything on this page — the fields, the timeline, the actions —
// comes from the version the record is pinned to, so a record keeps the shape it was created in.

export default async function RecordPage(
  props: PageProps<"/d/[dept]/f/[featureKey]/[recordId]">,
) {
  const { dept, featureKey, recordId } = await props.params;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);

  const model = await featureRecord(db, recordId, actorOf(ctx));
  if (!model) {
    // a notification minted before the feature kernel (or one that still addresses the Task row)
    // carries the task id; the record is what every page is addressed by
    const task = await db.task.findUnique({
      where: { id: recordId },
      select: { featureRecordId: true },
    });
    if (task?.featureRecordId)
      redirect(`/d/${dept}/f/${featureKey}/${task.featureRecordId}` as Route);
    notFound();
  }
  if (model.resolved.key !== featureKey) notFound();
  await requireCan(
    ctx,
    `feature.${featureKey}.view`,
    { subjectType: "feature_record", subjectId: recordId },
    "read",
  );

  const { record, resolved, fields, steps, actions, activeSteps } = model;
  const terminal = resolved.def.terminalStates.find((t) => t.key === record.currentStateKey);
  const stateLabel =
    terminal?.label ??
    resolved.tree.byKey[record.currentStateKey]?.step.label ??
    resolved.tree.parallels.find((p) => p.group.key === record.currentStateKey)?.group.label ??
    record.currentStateKey;
  const subject = { subjectType: "feature_record", subjectId: recordId };
  const base = `/d/${dept}/f/${featureKey}/${recordId}`;
  const timeline = await history(db, subject, 50);
  // what the module behind this feature adds: a task's deliverable slots, an import's rows
  registerRecordSurfaces();
  const extras = (await surfaceFor(featureKey)?.recordExtras?.({ ctx, db, record })) ?? {};

  return (
    <FeatureRecordShell
      dept={dept}
      featureKey={featureKey}
      recordId={recordId}
      crumbs={[
        { label: resolved.def.labels.plural, href: `/d/${dept}/f/${featureKey}` },
        { label: record.number },
      ]}
      title={record.title}
      description={`${record.number}${record.presetKey ? ` · ${record.presetKey}` : ""}`}
      state={{
        key: record.currentStateKey,
        label: stateLabel,
        category: terminal ? "terminal" : "active",
        terminalCategory: terminal?.category,
      }}
      overdue={!!record.deadlineAt && !record.closedAt && record.deadlineAt < new Date()}
      dueLabel={record.deadlineAt ? `due ${record.deadlineAt.toISOString().slice(0, 10)}` : null}
      fields={fields}
      steps={steps}
      actions={actions}
      history={timeline}
      slots={extras.slots}
      slotSubject={extras.slotSubject}
      canUploadSlots={extras.canUploadSlots}
      slotsLabel={extras.slotsLabel}
      acknowledgements={extras.acknowledgements}
      documents={<SubjectDocuments ctx={ctx} db={db} subject={subject} path={base} />}
      comments={<SubjectThread ctx={ctx} db={db} subject={subject} path={base} />}
      extras={
        [
          ...(extras.panels ?? []),
          ...(record.taskId
            ? [
                {
                  key: "task-actions",
                  label: "Nudge",
                  content: <TaskActionsPanel dept={dept} taskId={record.taskId} />,
                },
              ]
            : []),
          ...(activeSteps.length
          ? [
              {
                key: "open-steps",
                label: "Open steps",
                content: (
                  <div className="flex flex-wrap gap-2">
                    {activeSteps.map((step) => (
                      <Button key={step.id} asChild variant="outline" size="sm">
                        <Link
                          href={
                            `${base}/steps/${step.stepKey}${step.branchKey ? `?branch=${step.branchKey}` : ""}` as Route
                          }
                        >
                          Open {step.label}
                        </Link>
                      </Button>
                    ))}
                  </div>
                ),
              },
            ]
          : []),
        ]
      }
    />
  );
}
