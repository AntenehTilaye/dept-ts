import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import {
  aggregateCampaign,
  createCampaign,
  openCampaign,
  publishCampaign,
  results,
  submitViaToken,
} from "@/platform/campaign";
import { defineForm, type FieldDef } from "@/platform/forms";
import { migratorDb, rawClient, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

// Anonymity is structural, not a promise in the service: there is no column that could lead
// from a response back to a respondent, the database refuses to store one, and the timestamps
// are day-truncated so they cannot be correlated either.

const field = (x: FieldDef): FieldDef => ({ sourceBinding: "none", aggregation: "none", ...x });
const DAY = 86_400_000;

let termId: string;
let headUserId: string;
let persons: string[] = [];

const FIELDS: FieldDef[] = [
  field({
    key: "score",
    type: "likert",
    label: "Score",
    aggregation: "mean",
    constraints: { required: true, min: 1, max: 5 },
  }),
  field({ key: "comment", type: "long_text", label: "Comment", constraints: { required: false } }),
];

async function anonymousCampaign() {
  const key = `a_${f.uniqueSuffix()}`;
  await withTenantTx(DEPT_CS, (tx) =>
    defineForm(tx, {
      key,
      kind: "evaluation",
      title: "Anonymous",
      fields: FIELDS,
      departmentId: DEPT_CS,
      publish: true,
    }),
  );
  const now = Date.now();
  const campaign = await withTenantTx(DEPT_CS, (tx) =>
    createCampaign(tx, DEPT_CS, headUserId, {
      kind: "evaluation",
      title: `Anonymous ${key}`,
      formKey: key,
      termId,
      window: {
        opens: { at: new Date(now - 1000).toISOString() },
        closes: { at: new Date(now + DAY).toISOString() },
      },
      anonymityMode: "anonymous",
      audienceSpec: { persons },
      minResponsesForReport: 2,
    }),
  );
  await withTenantTx(DEPT_CS, (tx) => publishCampaign(tx, campaign.id));
  await withTenantTx(DEPT_CS, (tx) => openCampaign(tx, campaign.id));
  const notifications = await migratorDb.notification.findMany({
    where: { subjectType: "campaign", subjectId: campaign.id },
  });
  return {
    campaign,
    tokens: notifications.map((n) => decodeURIComponent(n.actionUrl!.split("/c/")[1]!)),
  };
}

beforeAll(async () => {
  const head = await migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } });
  headUserId = head.id;
  termId = (
    await migratorDb.term.findFirstOrThrow({ where: { departmentId: DEPT_CS, status: "current" } })
  ).id;
  const people = await Promise.all([
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
  ]);
  persons = people.map((p) => p.id);
});

describe("campaign anonymity", () => {
  it("stores no respondent, no invitation and a day-truncated timestamp", async () => {
    const { campaign, tokens } = await anonymousCampaign();
    for (const [i, token] of tokens.entries())
      await withTenantTx(DEPT_CS, (tx) => submitViaToken(tx, token, { score: 3 + (i % 3) }));

    const submissions = await migratorDb.submission.findMany({
      where: { campaignId: campaign.id },
    });
    expect(submissions).toHaveLength(tokens.length);
    for (const s of submissions) {
      expect(s.respondentPersonId).toBeNull();
      expect(s.invitationId).toBeNull();
      expect(s.submittedAt!.getTime() % DAY).toBe(0);
    }
    // the invitations know only that they were used, on which day
    const invitations = await migratorDb.campaignInvitation.findMany({
      where: { campaignId: campaign.id },
    });
    expect(invitations.every((i) => i.status === "submitted")).toBe(true);
    expect(invitations.every((i) => i.submittedAt!.getTime() % DAY === 0)).toBe(true);
  });

  it("the database refuses a respondent or an invitation on an anonymous submission", async () => {
    const { campaign } = await anonymousCampaign();
    const form = await migratorDb.formDefinition.findUniqueOrThrow({
      where: { id: campaign.formDefinitionId },
    });
    const c = await rawClient("migrator");
    try {
      await expect(
        c.query(
          `INSERT INTO submission (id, department_id, form_definition_id, form_version, campaign_id, respondent_person_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'submitted')`,
          ["s-anon-1", DEPT_CS, form.id, form.version, campaign.id, persons[0]],
        ),
      ).rejects.toThrow(/anonymous submission/);
      await expect(
        c.query(
          `INSERT INTO submission (id, department_id, form_definition_id, form_version, campaign_id, invitation_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'submitted')`,
          ["s-anon-2", DEPT_CS, form.id, form.version, campaign.id, "some-invitation"],
        ),
      ).rejects.toThrow(/anonymous submission/);
      // a timestamp that is not day-truncated is refused too
      await expect(
        c.query(
          `INSERT INTO submission (id, department_id, form_definition_id, form_version, campaign_id, status, submitted_at)
           VALUES ($1, $2, $3, $4, $5, 'submitted', now())`,
          ["s-anon-3", DEPT_CS, form.id, form.version, campaign.id],
        ),
      ).rejects.toThrow(/day-truncated/);
    } finally {
      await c.end();
    }
  });

  it("no join across submission, invitation and audit re-identifies a respondent", async () => {
    const { campaign, tokens } = await anonymousCampaign();
    for (const token of tokens)
      await withTenantTx(DEPT_CS, (tx) => submitViaToken(tx, token, { score: 5 }));

    // the adversarial join: line up responses with invitations by timestamp
    const rows = await migratorDb.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n
      FROM submission s
      JOIN campaign_invitation i
        ON i.campaign_id = s.campaign_id AND i.submitted_at = s.submitted_at
      WHERE s.campaign_id = ${campaign.id}
        AND (s.respondent_person_id IS NOT NULL OR s.invitation_id IS NOT NULL)`;
    expect(Number(rows[0]!.n)).toBe(0);

    // every submission shares the same day, so a timestamp match is ambiguous by construction
    const distinct = await migratorDb.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(DISTINCT submitted_at) AS n FROM submission WHERE campaign_id = ${campaign.id}`;
    expect(Number(distinct[0]!.n)).toBe(1);

    // and the audit trail of a public submission names no actor
    const audits = await migratorDb.auditEvent.findMany({
      where: { subjectType: "submission", action: "create" },
      orderBy: { at: "desc" },
      take: tokens.length,
    });
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.every((a) => a.actorUserId === null)).toBe(true);
  });

  it("free text is never released for an anonymous campaign", async () => {
    const { campaign, tokens } = await anonymousCampaign();
    for (const token of tokens)
      await withTenantTx(DEPT_CS, (tx) =>
        submitViaToken(tx, token, { score: 4, comment: "please fix the projector" }),
      );
    await migratorDb.systemSetting.update({
      where: { key_scope_scopeId: { key: "campaign.kThreshold", scope: "global", scopeId: "" } },
      data: { valueJson: 2 },
    });
    await withTenantTx(DEPT_CS, (tx) => aggregateCampaign(tx, campaign.id));
    const view = await withTenantTx(DEPT_CS, (tx) => results(tx, campaign.id));
    const comment = view.cells.find((c) => c.questionStableKey === "comment")!;
    expect(comment.suppressed).toBe(false);
    expect(comment.stats).toMatchObject({ kind: "text", samples: [] });
    const score = view.cells.find((c) => c.questionStableKey === "score")!;
    expect(score.stats).toMatchObject({ kind: "numeric", mean: 4 });
    await migratorDb.systemSetting.update({
      where: { key_scope_scopeId: { key: "campaign.kThreshold", scope: "global", scopeId: "" } },
      data: { valueJson: 5 },
    });
  });
});
