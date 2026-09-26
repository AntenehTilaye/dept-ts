import type { PrismaClient } from "../../../src/generated/prisma/client";
import { withTenantTx } from "../../../src/lib/db/tenant";
import { runWithAudit } from "../../../src/platform/audit/context";
import { upload } from "../../../src/platform/document";
import { act, createRecord } from "../../../src/platform/feature";

// Demo committees (SEED_DEMO=1). They are created the way a department creates one — a record of
// the `committee` feature, its terms of reference attached, then constituted — so the demo shows
// the process rather than rows somebody inserted behind it.

const DEPARTMENT_ID = "dep_cs";

/** A minimal but real PDF, so the terms of reference download and open like any other paper. */
function torPdf(name: string): Buffer {
  const text = `Terms of reference: ${name}`;
  const body = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
    `4 0 obj<</Length ${text.length + 44}>>stream`,
    `BT /F1 14 Tf 72 760 Td (${text}) Tj ET`,
    "endstream endobj",
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
  ].join("\n");
  return Buffer.from(body, "utf8");
}

const COMMITTEES = [
  {
    name: "Curriculum Committee",
    purpose: "Keeps the programme's courses coherent and current.",
    type: "standing",
    chair: "chair.cs@deptts.local",
    members: ["instructor1.cs@deptts.local", "instructor2.cs@deptts.local"],
    tasks: [
      "Review the CS201 syllabus against the new programme outcomes",
      "Collect course outlines for Semester I",
    ],
  },
  {
    name: "Ethics Review Panel",
    purpose: "Reviews research and project proposals that involve people or their data.",
    type: "review",
    chair: "instructor2.cs@deptts.local",
    members: ["instructor3.cs@deptts.local", "dpt.cs@deptts.local"],
    tasks: ["Draft the consent form the department will use"],
  },
];

export async function seedDemoCommittees(db: PrismaClient) {
  const head = await db.person.findFirst({ where: { email: "dh.cs@deptts.local" } });
  if (!head?.userId) return;
  const actor = {
    userId: head.userId,
    personId: head.id,
    departmentId: DEPARTMENT_ID,
    isAdmin: false,
  };

  for (const spec of COMMITTEES) {
    if (await db.committee.findFirst({ where: { departmentId: DEPARTMENT_ID, name: spec.name } }))
      continue;
    const people = await db.person.findMany({
      where: { email: { in: [spec.chair, ...spec.members] } },
      select: { id: true, email: true },
    });
    const byEmail = new Map(people.map((p) => [p.email!, p.id]));
    const chairId = byEmail.get(spec.chair);
    if (!chairId) continue;

    await runWithAudit(
      {
        departmentId: DEPARTMENT_ID,
        actorUserId: head.userId,
        correlationId: `seed:demo-committee:${spec.name}`,
      },
      async () => {
        await withTenantTx(DEPARTMENT_ID, async (tx) => {
          const record = await createRecord(tx, DEPARTMENT_ID, actor, "committee", {
            data: {
              name: spec.name,
              purpose: spec.purpose,
              type: spec.type,
              chair: chairId,
              members: spec.members
                .map((email) => byEmail.get(email))
                .filter((id): id is string => !!id),
              responsibilities: spec.purpose,
              start_date: new Date().toISOString().slice(0, 10),
            },
          });
          await upload(
            tx,
            actor,
            torPdf(spec.name),
            {
              title: `${spec.name} — terms of reference`,
              mimeType: "application/pdf",
              originalName: "terms-of-reference.pdf",
              category: "governance",
            },
            [
              {
                subjectType: "feature_record",
                subjectId: record.id,
                linkRole: "evidence",
                slotKey: "tor",
              },
            ],
          );
          await act(tx, record.id, "setup", "activate", actor);

          for (const title of spec.tasks) {
            const committee = await tx.committee.findUniqueOrThrow({ where: { id: record.id } });
            const task = await createRecord(tx, DEPARTMENT_ID, actor, "task", {
              presetKey: "committee_task",
              parentRef: { subjectType: "committee", subjectId: committee.id },
              data: {
                title,
                description: `${spec.name}: ${title}.`,
                assignee: chairId,
                priority: "normal",
                due_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
              },
            });
            await act(tx, task.id, "draft", "assign", actor);
          }
        });
      },
    );
  }
}
