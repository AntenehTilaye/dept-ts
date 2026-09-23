import type { PrismaClient } from "../../../src/generated/prisma/client";
import { withTenantTx } from "../../../src/lib/db/tenant";
import { runWithAudit } from "../../../src/platform/audit/context";
import { defineForm } from "../../../src/platform/forms/definitions";
import type { FieldDef } from "../../../src/platform/forms/field-schema";
import { createCampaign, openCampaign, publishCampaign } from "../../../src/platform/campaign";

// Demo survey and an open campaign over every CS instructor (SEED_DEMO=1). Anonymous, so the
// seeded data also exercises the anonymity trigger and the k-anonymity suppression.

const DEPARTMENT_ID = "dep_cs";
export const DEMO_FORM_KEY = "demo_survey";
export const DEMO_CAMPAIGN_TITLE = "Teaching support survey";

const field = (f: FieldDef): FieldDef => ({ sourceBinding: "none", aggregation: "none", ...f });

const DEMO_FIELDS: FieldDef[] = [
  field({
    key: "support",
    type: "likert",
    label: "The department supports my teaching well",
    helpText: "1 = strongly disagree, 5 = strongly agree",
    aggregation: "mean",
    constraints: { required: true, min: 1, max: 5 },
  }),
  field({
    key: "mode",
    type: "single_choice",
    label: "Which delivery mode works best for your courses?",
    aggregation: "count",
    options: [
      { value: "onsite", label: "On site" },
      { value: "blended", label: "Blended" },
      { value: "online", label: "Online" },
    ],
    constraints: { required: true },
  }),
  field({
    key: "priorities",
    type: "ranked_list",
    label: "Rank what the department should improve first",
    aggregation: "rank_sum",
    options: [
      { value: "labs", label: "Laboratory equipment" },
      { value: "assistants", label: "Teaching assistants" },
      { value: "rooms", label: "Room allocation" },
    ],
    constraints: { required: true, maxRank: 3 },
  }),
  field({
    key: "comment",
    type: "long_text",
    label: "Anything else the department should know?",
    constraints: { required: false },
  }),
];

export async function seedDemoCampaign(db: PrismaClient) {
  const head = await db.person.findFirst({ where: { email: "dh.cs@deptts.local" } });
  const term = await db.term.findFirst({
    where: { departmentId: DEPARTMENT_ID, status: "current" },
  });
  if (!head?.userId || !term) return;
  if (
    await db.campaign.findFirst({
      where: { departmentId: DEPARTMENT_ID, title: DEMO_CAMPAIGN_TITLE },
    })
  )
    return;

  const now = Date.now();
  await runWithAudit(
    { departmentId: DEPARTMENT_ID, actorUserId: head.userId, correlationId: "seed:demo-campaign" },
    async () => {
      await withTenantTx(DEPARTMENT_ID, async (tx) => {
        await defineForm(tx, {
          key: DEMO_FORM_KEY,
          kind: "survey",
          title: "Teaching support survey",
          description: "A short anonymous survey of the department's teaching support.",
          fields: DEMO_FIELDS,
          departmentId: DEPARTMENT_ID,
          createdBy: head.userId,
          publish: true,
        });
        const campaign = await createCampaign(tx, DEPARTMENT_ID, head.userId!, {
          kind: "survey",
          title: DEMO_CAMPAIGN_TITLE,
          formKey: DEMO_FORM_KEY,
          termId: term.id,
          window: {
            opens: { at: new Date(now - 3_600_000).toISOString() },
            closes: { at: new Date(now + 3 * 86_400_000).toISOString() },
          },
          anonymityMode: "anonymous",
          submissionRule: "single",
          audienceSpec: { roles: ["instructor"] },
          aggregationSpec: { groupBy: ["role"] },
          minResponsesForReport: 2,
        });
        await publishCampaign(tx, campaign.id);
        // the window is already open, so the invitations go out with the seed
        await openCampaign(tx, campaign.id);
      });
    },
  );
}
