/**
 * Gives every existing Task the FeatureRecord it should have been created as.
 *
 *   docker compose run --rm web npx tsx prisma/scripts/backfill-task-feature-records.ts
 *
 * P7 created tasks against a hand-written `task` workflow; P9 compiles the same lifecycle from
 * prisma/seed/features/task.ts. This script moves each old task onto the compiled one: it writes
 * a record with the task's own answers, re-points the workflow instance at that record (the state
 * names are identical, which is why the seeded definition mirrors them), and opens a step
 * instance for wherever the task currently stands. It is idempotent — a task that already has a
 * record is skipped — so it can be run again after a partial run.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { newId } from "../../src/lib/id";
import { toJson } from "../../src/lib/db/json";
import { bootstrap } from "../../src/lib/bootstrap";
import { stopBoss } from "../../src/lib/db/boss";
import { withTenantBypass } from "../../src/lib/db/tenant";
import { FeatureDefinitionSchema } from "../../src/platform/feature/schema";
import { buildTree } from "../../src/platform/feature/tree";
import { nextNumber } from "../../src/platform/feature/runtime/create";

const url = process.env.DATABASE_URL_MIGRATE;
if (!url) throw new Error("DATABASE_URL_MIGRATE is not set");
const db = new PrismaClient({
  adapter: new PrismaPg(
    { connectionString: url },
    { schema: new URL(url).searchParams.get("schema") ?? "public" },
  ),
});

interface Slot {
  key: string;
  label: string;
  required?: boolean;
}

async function main(): Promise<void> {
  bootstrap();
  const outcome = { records: 0, skipped: 0, steps: 0 };

  await withTenantBypass({ worker: true, jobName: "backfill" }, "task → feature record", async (tx) => {
    const definition = await tx.featureDefinition.findFirst({
      where: { key: "task", departmentId: null },
    });
    if (!definition?.activeVersionId)
      throw new Error("the `task` feature is not published; run `prisma db seed` first");
    const version = await tx.featureDefinitionVersion.findUniqueOrThrow({
      where: { id: definition.activeVersionId },
    });
    const def = FeatureDefinitionSchema.parse(version.json);
    const tree = buildTree(def);
    const workflow = await tx.workflowDefinition.findFirstOrThrow({
      where: { key: "feature:task", status: "active" },
    });

    const tasks = await tx.task.findMany({
      where: { featureRecordId: null, kind: { not: "feature_step" } },
      orderBy: { createdAt: "asc" },
      include: { assignments: true },
    });

    for (const task of tasks) {
      const instance = await tx.workflowInstance.findFirst({
        where: { subjectType: "task", subjectId: task.id },
      });
      if (!instance) {
        outcome.skipped += 1;
        continue;
      }

      const creator = await tx.person.findFirst({
        where: { userId: task.createdBy },
        select: { id: true },
      });
      const assignee = task.assignments.find((a) => a.assigneeType === "person");
      const ownerPersonId = creator?.id ?? assignee?.assigneeId;
      if (!ownerPersonId) {
        outcome.skipped += 1;
        continue;
      }

      const slots = (Array.isArray(task.expectedDeliverablesJson)
        ? (task.expectedDeliverablesJson as unknown as Slot[])
        : []
      ).map((slot) => ({ key: slot.key, label: slot.label, required: slot.required === true }));

      const recordId = newId();
      const number = await nextNumber(tx, task.departmentId, {
        definitionId: definition.id,
        def,
      });
      await tx.featureRecord.create({
        data: {
          id: recordId,
          departmentId: task.departmentId,
          definitionId: definition.id,
          definitionVersionId: version.id,
          number,
          title: task.title,
          data: toJson({
            title: task.title,
            description: task.description ?? "",
            assignee: assignee?.assigneeId ?? "",
            kind: task.kind,
            priority: task.priority,
            due_at: task.dueAt?.toISOString() ?? "",
            deliverables: slots,
          }),
          presetKey: task.kind,
          parentSubjectType: task.contextType,
          parentSubjectId: task.contextId,
          scopeType: "department",
          ownerPersonId,
          createdByPersonId: ownerPersonId,
          workflowInstanceId: instance.id,
          currentStateKey: instance.currentState,
          deadlineAt: task.dueAt,
          closedAt: task.completedAt,
          taskId: task.id,
        },
      });
      await tx.task.update({ where: { id: task.id }, data: { featureRecordId: recordId } });

      // the instance moves from the task to the record, onto the compiled definition
      await tx.workflowInstance.update({
        where: { id: instance.id },
        data: {
          subjectType: "feature_record",
          subjectId: recordId,
          definitionId: workflow.id,
          definitionKey: workflow.key,
          definitionVersion: workflow.version,
        },
      });

      // and the step it is standing in, so the runtime has something to act on
      const leaf = tree.byKey[instance.currentState];
      if (leaf) {
        await tx.featureStepInstance.create({
          data: {
            departmentId: task.departmentId,
            recordId,
            stepKey: leaf.step.key,
            sequence: 1,
            status: "active",
            assigneeType: assignee ? "person" : null,
            assigneeId: assignee?.assigneeId ?? null,
            deadlineAt: task.dueAt,
          },
        });
        outcome.steps += 1;
      }
      outcome.records += 1;
    }
  });

  console.log(
    `backfill: ${outcome.records} record(s) created, ${outcome.steps} step instance(s), ${outcome.skipped} task(s) skipped`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopBoss();
    await db.$disconnect();
  });
