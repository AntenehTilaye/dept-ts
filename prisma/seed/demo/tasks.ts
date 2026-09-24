import type { PrismaClient } from "../../../src/generated/prisma/client";
import { runWithAudit } from "../../../src/platform/audit/context";
import { withTenantTx } from "../../../src/lib/db/tenant";
import { act, createRecord } from "../../../src/platform/feature";

// Demo work items (SEED_DEMO=1): one personal task with a required deliverable due in two days
// (which produces the ack-required notification and the reminder ledger rows) and one
// department-wide task addressed to every instructor.
//
// They are created through the feature runtime, as every task is since the feature kernel: the
// record IS the Task row, and its lifecycle is the compiled `feature:task` workflow.

const DEPARTMENT_ID = "dep_cs";
const DEMO_TITLE = "Prepare the CS201 final examination paper";

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
        const personal = await createRecord(tx, DEPARTMENT_ID, actor, "task", {
          presetKey: "instructor_task",
          data: {
            title: DEMO_TITLE,
            description:
              "Prepare the CS201 final examination paper and the marking guide, and upload both here.",
            assignee: instructor.id,
            priority: "high",
            due_at: inTwoDays.toISOString(),
            deliverables: [
              { key: "paper", label: "Examination paper", required: true },
              { key: "guide", label: "Marking guide", required: false },
            ],
          },
        });
        // assigning is what notifies the assignee and starts the reminders
        await act(tx, personal.id, "draft", "assign", actor);

        const departmentWide = await createRecord(tx, DEPARTMENT_ID, actor, "task", {
          presetKey: "department_task",
          data: {
            title: "Confirm your office hours for Semester I",
            description:
              "Every instructor confirms the office hours shown on their profile before the term starts.",
            audience: ["instructor"],
            priority: "normal",
            due_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          },
        });
        await act(tx, departmentWide.id, "draft", "assign", actor);
      });
    },
  );
}
