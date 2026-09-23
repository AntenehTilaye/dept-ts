import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap } from "@/lib/bootstrap";
import { withTenantTx } from "@/lib/db/tenant";
import { createCampaign, publishCampaign, submitViaToken } from "@/platform/campaign";
import { defineForm, type FieldDef } from "@/platform/forms";
import campaignAggregate from "../../apps/worker/src/handlers/campaign-aggregate";
import campaignClose from "../../apps/worker/src/handlers/campaign-close";
import campaignOpen from "../../apps/worker/src/handlers/campaign-open";
import { migratorDb, withDept } from "../setup/db";
import { DEPT_CS } from "../setup/seed-minimal";
import * as f from "../setup/factories";
import { awaitJob, startTestBoss } from "../setup/boss";

vi.setConfig({ testTimeout: 90_000 });
bootstrap();

const field = (x: FieldDef): FieldDef => ({ sourceBinding: "none", aggregation: "none", ...x });
const DAY = 86_400_000;

let boss: PgBoss;
let termId: string;
let headUserId: string;
let persons: string[] = [];

async function newCampaign() {
  const key = `w_${f.uniqueSuffix()}`;
  await withTenantTx(DEPT_CS, (tx) =>
    defineForm(tx, {
      key,
      kind: "survey",
      title: "Worker survey",
      fields: [
        field({
          key: "score",
          type: "likert",
          label: "Score",
          aggregation: "mean",
          constraints: { required: true, min: 1, max: 5 },
        }),
      ],
      departmentId: DEPT_CS,
      publish: true,
    }),
  );
  const now = Date.now();
  const campaign = await withTenantTx(DEPT_CS, (tx) =>
    createCampaign(tx, DEPT_CS, headUserId, {
      kind: "survey",
      title: `Worker ${key}`,
      formKey: key,
      termId,
      window: {
        opens: { at: new Date(now - 1000).toISOString() },
        closes: { at: new Date(now + DAY).toISOString() },
      },
      audienceSpec: { persons },
      minResponsesForReport: 1,
    }),
  );
  await withTenantTx(DEPT_CS, (tx) => publishCampaign(tx, campaign.id));
  return campaign;
}

beforeAll(async () => {
  boss = await startTestBoss([campaignOpen, campaignClose, campaignAggregate]);
  const head = await migratorDb.user.findUniqueOrThrow({ where: { email: "dh.cs@deptts.local" } });
  headUserId = head.id;
  termId = (
    await migratorDb.term.findFirstOrThrow({ where: { departmentId: DEPT_CS, status: "current" } })
  ).id;
  const people = await Promise.all([
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
    withDept(DEPT_CS, (tx) => f.staff(tx, DEPT_CS)),
  ]);
  persons = people.map((p) => p.id);
});
afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5_000 });
});

describe("campaign worker jobs", () => {
  it("campaign.open sends each invitation once, even when the job runs twice", async () => {
    const campaign = await newCampaign();
    const data = { campaignId: campaign.id, departmentId: DEPT_CS };
    const id = await boss.send("campaign.open", data);
    await awaitJob(boss, "campaign.open", id!);
    const sent = await migratorDb.notification.count({
      where: { subjectType: "campaign", subjectId: campaign.id },
    });
    expect(sent).toBe(persons.length);
    const hashes = (
      await migratorDb.campaignInvitation.findMany({ where: { campaignId: campaign.id } })
    ).map((i) => i.tokenHash);
    expect(hashes.every((h) => !h.startsWith("unissued:"))).toBe(true);

    // a second run neither re-sends nor rotates the tokens that were already mailed
    await campaignOpen.handle([{ data } as never], { boss });
    expect(
      await migratorDb.notification.count({
        where: { subjectType: "campaign", subjectId: campaign.id },
      }),
    ).toBe(sent);
    const after = (
      await migratorDb.campaignInvitation.findMany({ where: { campaignId: campaign.id } })
    ).map((i) => i.tokenHash);
    expect(after.sort()).toEqual(hashes.sort());
    expect(
      (
        await migratorDb.scheduledJob.findUniqueOrThrow({
          where: { idempotencyKey: `campaign:${campaign.id}:open` },
        })
      ).status,
    ).toBe("done");
  });

  it("campaign.close expires the tokens and campaign.aggregate computes the results", async () => {
    const campaign = await newCampaign();
    const data = { campaignId: campaign.id, departmentId: DEPT_CS };
    await campaignOpen.handle([{ data } as never], { boss });
    const notifications = await migratorDb.notification.findMany({
      where: { subjectType: "campaign", subjectId: campaign.id },
    });
    for (const n of notifications) {
      const token = decodeURIComponent(n.actionUrl!.split("/c/")[1]!);
      await withTenantTx(DEPT_CS, (tx) => submitViaToken(tx, token, { score: 4 }));
    }

    const closeId = await boss.send("campaign.close", data);
    await awaitJob(boss, "campaign.close", closeId!);
    const invitations = await migratorDb.campaignInvitation.findMany({
      where: { campaignId: campaign.id },
    });
    expect(invitations.every((i) => i.status === "submitted")).toBe(true);
    expect(
      (await migratorDb.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).closedAt,
    ).not.toBeNull();

    const aggId = await boss.send("campaign.aggregate", data);
    await awaitJob(boss, "campaign.aggregate", aggId!);
    const cells = await migratorDb.aggregationResult.findMany({
      where: { campaignId: campaign.id },
    });
    expect(cells.length).toBeGreaterThan(0);
    // running the aggregation again replaces the cells rather than duplicating them
    await campaignAggregate.handle([{ data } as never], { boss });
    expect(await migratorDb.aggregationResult.count({ where: { campaignId: campaign.id } })).toBe(
      cells.length,
    );
  });

  it("closing a campaign that is already closed is a no-op", async () => {
    const campaign = await newCampaign();
    const data = { campaignId: campaign.id, departmentId: DEPT_CS };
    await campaignClose.handle([{ data } as never], { boss });
    const first = await migratorDb.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    await campaignClose.handle([{ data } as never], { boss });
    const second = await migratorDb.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(second.closedAt?.getTime()).toBe(first.closedAt?.getTime());
  });
});
