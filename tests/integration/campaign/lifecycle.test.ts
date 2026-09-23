import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import {
  aggregateCampaign,
  CampaignError,
  closeCampaign,
  createCampaign,
  exportResults,
  hashToken,
  openCampaign,
  openLink,
  participation,
  publishCampaign,
  rescheduleCampaign,
  results,
  submitViaToken,
} from "@/platform/campaign";
import { defineForm, type FieldDef } from "@/platform/forms";
import { setPeriod } from "@/platform/academic/calendar";
import { LocalDiskStorage, setStorage } from "@/lib/storage";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS } from "../../setup/seed-minimal";
import * as f from "../../setup/factories";

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

const field = (x: FieldDef): FieldDef => ({ sourceBinding: "none", aggregation: "none", ...x });
const DAY = 86_400_000;

let root: string;
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

async function newCampaign(over: Partial<Parameters<typeof createCampaign>[3]> = {}) {
  const key = `c_${f.uniqueSuffix()}`;
  await withTenantTx(DEPT_CS, (tx) =>
    defineForm(tx, {
      key,
      kind: "survey",
      title: "Survey",
      fields: FIELDS,
      departmentId: DEPT_CS,
      publish: true,
    }),
  );
  const now = Date.now();
  return withTenantTx(DEPT_CS, (tx) =>
    createCampaign(tx, DEPT_CS, headUserId, {
      kind: "survey",
      title: `Survey ${key}`,
      formKey: key,
      termId,
      window: {
        opens: { at: new Date(now - 1000).toISOString() },
        closes: { at: new Date(now + 3 * DAY).toISOString() },
      },
      audienceSpec: { persons },
      minResponsesForReport: 2,
      ...over,
    }),
  );
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "deptts-campaign-"));
  setStorage(new LocalDiskStorage(root));
  const head = await migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } });
  headUserId = head.id;
  const term = await migratorDb.term.findFirstOrThrow({
    where: { departmentId: DEPT_CS, status: "current" },
  });
  termId = term.id;
  const people = await Promise.all([
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
  ]);
  persons = people.map((p) => p.id);
});

describe("campaign lifecycle", () => {
  it("publishes invitations without tokens, then mints and mails one per invitation on open", async () => {
    const campaign = await newCampaign();
    const published = await withTenantTx(DEPT_CS, (tx) => publishCampaign(tx, campaign.id));
    expect(published.invitations).toBe(persons.length);
    const before = await migratorDb.campaignInvitation.findMany({
      where: { campaignId: campaign.id },
    });
    expect(before.every((i) => i.tokenHash.startsWith("unissued:"))).toBe(true);
    // the window jobs and the closing reminders exist
    expect(
      await migratorDb.scheduledJob.findUnique({
        where: { idempotencyKey: `campaign:${campaign.id}:open` },
      }),
    ).not.toBeNull();
    expect(
      await migratorDb.reminderSubscription.findFirst({
        where: { subjectType: "campaign", subjectId: campaign.id },
      }),
    ).not.toBeNull();

    const sent = await withTenantTx(DEPT_CS, (tx) => openCampaign(tx, campaign.id));
    expect(sent).toBe(persons.length);
    const after = await migratorDb.campaignInvitation.findMany({
      where: { campaignId: campaign.id },
    });
    expect(after.every((i) => !i.tokenHash.startsWith("unissued:"))).toBe(true);
    const notifications = await migratorDb.notification.findMany({
      where: { subjectType: "campaign", subjectId: campaign.id },
    });
    expect(notifications).toHaveLength(persons.length);
    expect(notifications[0]!.actionUrl).toContain("/c/");

    // running open again mints nothing new and sends nothing
    const again = await withTenantTx(DEPT_CS, (tx) => openCampaign(tx, campaign.id));
    expect(again).toBe(0);
    const unchanged = await migratorDb.campaignInvitation.findMany({
      where: { campaignId: campaign.id },
    });
    expect(unchanged.map((i) => i.tokenHash).sort()).toEqual(after.map((i) => i.tokenHash).sort());
  });

  it("accepts one identified response per token and refuses the second use", async () => {
    const campaign = await newCampaign({ anonymityMode: "identified" });
    await withTenantTx(DEPT_CS, (tx) => publishCampaign(tx, campaign.id));
    await withTenantTx(DEPT_CS, (tx) => openCampaign(tx, campaign.id));
    const token = tokenFromNotification(
      (
        await migratorDb.notification.findFirstOrThrow({
          where: { subjectType: "campaign", subjectId: campaign.id },
        })
      ).actionUrl!,
    );

    const link = await withTenantTx(DEPT_CS, (tx) => openLink(tx, token));
    expect(link.campaign.id).toBe(campaign.id);
    expect(
      (
        await migratorDb.campaignInvitation.findUniqueOrThrow({
          where: { tokenHash: hashToken(token) },
        })
      ).status,
    ).toBe("opened");

    const submission = await withTenantTx(DEPT_CS, (tx) =>
      submitViaToken(tx, token, { score: 4, comment: "clear" }),
    );
    expect(submission.respondentPersonId).not.toBeNull();
    expect(submission.invitationId).toBe(link.invitationId);
    // the cohort attributes travel with the response
    expect(submission.cohortAttributesJson).toMatchObject({ role: "staff" });

    await expect(
      withTenantTx(DEPT_CS, (tx) => submitViaToken(tx, token, { score: 5 })),
    ).rejects.toBeInstanceOf(CampaignError);
  });

  it("editable_until_close replaces the response until the campaign closes", async () => {
    const campaign = await newCampaign({ submissionRule: "editable_until_close" });
    await withTenantTx(DEPT_CS, (tx) => publishCampaign(tx, campaign.id));
    await withTenantTx(DEPT_CS, (tx) => openCampaign(tx, campaign.id));
    const token = tokenFromNotification(
      (
        await migratorDb.notification.findFirstOrThrow({
          where: { subjectType: "campaign", subjectId: campaign.id },
        })
      ).actionUrl!,
    );
    const first = await withTenantTx(DEPT_CS, (tx) => submitViaToken(tx, token, { score: 2 }));
    const second = await withTenantTx(DEPT_CS, (tx) => submitViaToken(tx, token, { score: 5 }));
    expect(second.id).toBe(first.id);
    expect(await migratorDb.submission.count({ where: { campaignId: campaign.id } })).toBe(1);
    const answers = await migratorDb.answer.findMany({ where: { submissionId: first.id } });
    expect(Number(answers.find((a) => a.questionStableKey === "score")!.numericValue)).toBe(5);

    await withTenantTx(DEPT_CS, (tx) => closeCampaign(tx, campaign.id));
    await expect(
      withTenantTx(DEPT_CS, (tx) => submitViaToken(tx, token, { score: 1 })),
    ).rejects.toThrow(/closed/);
  });

  it("closing expires the open tokens, cancels the reminders and queues the aggregation", async () => {
    const campaign = await newCampaign();
    await withTenantTx(DEPT_CS, (tx) => publishCampaign(tx, campaign.id));
    await withTenantTx(DEPT_CS, (tx) => openCampaign(tx, campaign.id));
    const { expired } = await withTenantTx(DEPT_CS, (tx) => closeCampaign(tx, campaign.id));
    expect(expired).toBe(persons.length);
    const invitations = await migratorDb.campaignInvitation.findMany({
      where: { campaignId: campaign.id },
    });
    expect(invitations.every((i) => i.status === "expired")).toBe(true);
    expect(
      (
        await migratorDb.reminderSubscription.findFirstOrThrow({
          where: { subjectType: "campaign", subjectId: campaign.id },
        })
      ).active,
    ).toBe(false);
    const aggregate = await migratorDb.scheduledJob.findFirst({
      where: { queue: "campaign.aggregate", subjectId: campaign.id },
    });
    expect(aggregate).not.toBeNull();
    // closing twice is a no-op
    expect((await withTenantTx(DEPT_CS, (tx) => closeCampaign(tx, campaign.id))).expired).toBe(0);
  });

  it("aggregates responses, suppresses below k and exports a CSV document", async () => {
    const campaign = await newCampaign({ aggregationSpec: { groupBy: ["role"] } });
    await withTenantTx(DEPT_CS, (tx) => publishCampaign(tx, campaign.id));
    await withTenantTx(DEPT_CS, (tx) => openCampaign(tx, campaign.id));
    const notifications = await migratorDb.notification.findMany({
      where: { subjectType: "campaign", subjectId: campaign.id },
    });
    const tokens = notifications.map((n) => tokenFromNotification(n.actionUrl!));
    for (const [i, token] of tokens.entries()) {
      await withTenantTx(DEPT_CS, (tx) =>
        submitViaToken(tx, token, { score: 3 + (i % 3), comment: `c${i}` }),
      );
    }
    const stats = await withTenantTx(DEPT_CS, (tx) => participation(tx, campaign.id));
    expect(stats).toMatchObject({ invited: 3, submitted: 3, responses: 3 });

    // with k = 5 every cell is withheld
    await migratorDb.systemSetting.update({
      where: { key_scope_scopeId: { key: "campaign.kThreshold", scope: "global", scopeId: "" } },
      data: { valueJson: 5 },
    });
    await withTenantTx(DEPT_CS, (tx) => aggregateCampaign(tx, campaign.id));
    const suppressed = await withTenantTx(DEPT_CS, (tx) => results(tx, campaign.id));
    expect(suppressed.cells.every((c) => c.suppressed)).toBe(true);

    // lowering the threshold reveals them
    await migratorDb.systemSetting.update({
      where: { key_scope_scopeId: { key: "campaign.kThreshold", scope: "global", scopeId: "" } },
      data: { valueJson: 2 },
    });
    await withTenantTx(DEPT_CS, (tx) => aggregateCampaign(tx, campaign.id));
    const view = await withTenantTx(DEPT_CS, (tx) => results(tx, campaign.id));
    const score = view.cells.find((c) => c.questionStableKey === "score")!;
    expect(score.suppressed).toBe(false);
    expect(score.stats).toMatchObject({ kind: "numeric", n: 3 });
    expect(view.participation.rate).toBe(1);

    const { document } = await withTenantTx(DEPT_CS, (tx) =>
      exportResults(tx, DEPT_CS, campaign.id, headUserId),
    );
    expect(document.title).toContain("results");
    const link = await migratorDb.documentLink.findFirstOrThrow({
      where: { documentId: document.id },
    });
    expect(link).toMatchObject({ subjectType: "campaign", subjectId: campaign.id });
    await migratorDb.systemSetting.update({
      where: { key_scope_scopeId: { key: "campaign.kThreshold", scope: "global", scopeId: "" } },
      data: { valueJson: 5 },
    });
  });

  it("re-resolves an anchored window when the calendar period moves", async () => {
    const key = `c_${f.uniqueSuffix()}`;
    await withTenantTx(DEPT_CS, (tx) =>
      defineForm(tx, {
        key,
        kind: "survey",
        title: "Anchored",
        fields: FIELDS,
        departmentId: DEPT_CS,
        publish: true,
      }),
    );
    const { period } = await withTenantTx(DEPT_CS, (tx) =>
      setPeriod(tx, DEPT_CS, {
        termId,
        kind: "evaluation",
        label: "Evaluation window",
        startAt: new Date(Date.now() + 10 * DAY),
        endAt: new Date(Date.now() + 20 * DAY),
      }),
    );
    const campaign = await withTenantTx(DEPT_CS, (tx) =>
      createCampaign(tx, DEPT_CS, headUserId, {
        kind: "evaluation",
        title: `Anchored ${key}`,
        formKey: key,
        termId,
        window: {
          opens: { periodKind: "evaluation", edge: "start" },
          closes: { periodKind: "evaluation", edge: "end" },
        },
        audienceSpec: { persons },
      }),
    );
    expect(campaign.resolvedOpensAt.getTime()).toBe(period.startAt.getTime());
    await withTenantTx(DEPT_CS, (tx) => publishCampaign(tx, campaign.id));

    const movedStart = new Date(Date.now() + 12 * DAY);
    await withTenantTx(DEPT_CS, (tx) =>
      setPeriod(tx, DEPT_CS, {
        id: period.id,
        termId,
        kind: "evaluation",
        label: "Evaluation window",
        startAt: movedStart,
        endAt: new Date(Date.now() + 25 * DAY),
      }),
    );
    const changed = await withTenantTx(DEPT_CS, (tx) => rescheduleCampaign(tx, campaign.id));
    expect(changed).toBe(true);
    const after = await migratorDb.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(after.resolvedOpensAt.getTime()).toBe(movedStart.getTime());
    const invitations = await migratorDb.campaignInvitation.findMany({
      where: { campaignId: campaign.id },
    });
    expect(
      invitations.every((i) => i.expiresAt.getTime() === after.resolvedClosesAt.getTime()),
    ).toBe(true);
  });
});

function tokenFromNotification(actionUrl: string): string {
  return decodeURIComponent(actionUrl.split("/c/")[1]!);
}
