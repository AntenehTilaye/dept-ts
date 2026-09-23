import type { PrismaClient } from "../../../src/generated/prisma/client";
import { runWithAudit } from "../../../src/platform/audit/context";
import { withTenantTx } from "../../../src/lib/db/tenant";
import { createTask } from "../../../src/platform/workitem";

// Demo work items (SEED_DEMO=1): one personal task with a required deliverable due in two days
// (which produces the ack-required notification and the reminder ledger rows) and one
// department-wide task addressed to every instructor.

const DEPARTMENT_ID = "dep_cs";

export async function seedDemoTasks(db: PrismaClient) {
  const [head, instructor] = await Promise.all([
    db.person.findFirst({ where: { email: "dh.cs@deptts.local" } }),
    db.person.findFirst({ where: { email: "instructor1.cs@deptts.local" } }),
  ]);
  if (!head?.userId || !instructor) return;
  if (await db.task.findFirst({ where: { departmentId: DEPARTMENT_ID, title: DEMO_TITLE } }))
    return;

  const actor = {
    userId: head.userId,
    personId: head.id,
    departmentId: DEPARTMENT_ID,
    isAdmin: false,
  };
  const inTwoDays = new Date(Date.now() + 2 * 86_400_000);

  await runWithAudit(
    { departmentId: DEPARTMENT_ID, actorUserId: head.userId, correlationId: "seed:demo-tasks" },
    async () => {
      await withTenantTx(DEPARTMENT_ID, async (tx) => {
        await createTask(tx, actor, {
          title: DEMO_TITLE,
          description:
            "Prepare the CS201 final examination paper and the marking guide, and upload both here.",
          kind: "instructor_task",
          priority: "high",
          dueAt: inTwoDays,
          assignees: [{ type: "person", id: instructor.id }],
          expectedDeliverables: [
            { key: "paper", label: "Examination paper", required: true },
            { key: "guide", label: "Marking guide", required: false },
          ],
        });
        await createTask(tx, actor, {
          title: "Confirm your office hours for Semester I",
          description:
            "Every instructor confirms the office hours shown on their profile before the term starts.",
          kind: "department_task",
          priority: "normal",
          dueAt: new Date(Date.now() + 7 * 86_400_000),
          assignees: [{ type: "audience", audienceSpec: { roles: ["instructor"] } }],
        });
      });
    },
  );
}

const DEMO_TITLE = "Prepare the CS201 final examination paper";
