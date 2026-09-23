import type {
  Anonymity,
  CampaignKind,
  CampaignSubjectType,
  EvaluatorGroup,
  SubmissionRule,
} from "@/generated/prisma/enums";
import { env } from "../../lib/env";
import { fromJson, toJson } from "../../lib/db/json";
import type { Db } from "../../lib/db/types";
import { withTenantBypass } from "../../lib/db/tenant";
import { publish as emit } from "../audit/outbox";
import { resolveTermAnchor } from "../academic/calendar";
import { activeForm, fieldsOf } from "../forms/definitions";
import { answersOf, submit, type AnswerMap } from "../forms/submissions";
import { dbAudienceLoader, resolveAudienceIds, type AudienceSpec } from "../people/audience";
import { enqueue } from "../scheduler/enqueue";
import { cancelByPrefix } from "../scheduler/ledger";
import { notify } from "../scheduler/notify";
import { cancelBySubject, subscribeReminders } from "../scheduler/reminders";
import { checkToken, hashToken, newToken, pseudonym, tokenUrl } from "./tokens";

// The campaign core: a windowed run of a form over an audience. The lifecycle (draft → open →
// closed → analyzed) is the seeded `campaign` feature's workflow from P15; everything here is
// the machinery those transitions call, and the window jobs that drive it meanwhile.

export class CampaignError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "closed" | "not_open" | "used" | "expired" | "invalid" = "invalid",
  ) {
    super(message);
    this.name = "CampaignError";
  }
}

export interface WindowAnchor {
  opens: { at: string } | { periodKind: string; edge: "start" | "end"; offsetDays?: number };
  closes: { at: string } | { periodKind: string; edge: "start" | "end"; offsetDays?: number };
}

export interface CreateCampaignInput {
  kind: CampaignKind;
  title: string;
  formKey: string;
  termId: string;
  window: WindowAnchor;
  anonymityMode?: Anonymity;
  submissionRule?: SubmissionRule;
  audienceSpec: AudienceSpec;
  subjects?: Array<{
    subjectType: CampaignSubjectType;
    subjectId: string;
    label: string;
    capacity?: number | null;
    evaluatorGroup?: EvaluatorGroup | null;
    evaluatorAudienceSpec?: AudienceSpec | null;
  }>;
  invitationTemplateKey?: string;
  reminderScheduleKey?: string;
  aggregationSpec?: { groupBy?: string[]; textSamples?: number } | null;
  minResponsesForReport?: number;
  options?: Record<string, unknown>;
}

async function resolveWindow(
  db: Db,
  termId: string,
  window: WindowAnchor,
): Promise<{ opensAt: Date; closesAt: Date }> {
  const at = async (spec: WindowAnchor["opens"]): Promise<Date> => {
    if ("at" in spec) return new Date(spec.at);
    return resolveTermAnchor(db, termId, {
      periodKind: spec.periodKind as never,
      edge: spec.edge,
      offsetDays: spec.offsetDays ?? 0,
    });
  };
  const opensAt = await at(window.opens);
  const closesAt = await at(window.closes);
  if (closesAt.getTime() <= opensAt.getTime())
    throw new CampaignError("A campaign must close after it opens");
  return { opensAt, closesAt };
}

export async function createCampaign(
  db: Db,
  departmentId: string,
  createdBy: string,
  input: CreateCampaignInput,
) {
  const form = await activeForm(db, input.formKey, departmentId);
  if (!form) throw new CampaignError(`No published form "${input.formKey}"`, "not_found");
  const { opensAt, closesAt } = await resolveWindow(db, input.termId, input.window);
  const campaign = await db.campaign.create({
    data: {
      departmentId,
      kind: input.kind,
      title: input.title,
      formDefinitionId: form.id,
      formVersion: form.version,
      termId: input.termId,
      windowAnchorJson: toJson(input.window),
      resolvedOpensAt: opensAt,
      resolvedClosesAt: closesAt,
      anonymityMode: input.anonymityMode ?? "identified",
      submissionRule: input.submissionRule ?? "single",
      audienceSpecJson: toJson(input.audienceSpec),
      subjectMode: input.subjects?.length ? "per_subject" : "none",
      invitationTemplateKey: input.invitationTemplateKey ?? "campaign_invitation",
      reminderScheduleKey: input.reminderScheduleKey ?? "default_7_3_1_0_overdue",
      aggregationSpecJson: input.aggregationSpec ? toJson(input.aggregationSpec) : undefined,
      minResponsesForReport: input.minResponsesForReport ?? 5,
      optionsJson: toJson(input.options ?? {}),
      createdBy,
    },
  });
  for (const s of input.subjects ?? []) {
    await db.campaignSubject.create({
      data: {
        departmentId,
        campaignId: campaign.id,
        subjectType: s.subjectType,
        subjectId: s.subjectId,
        label: s.label,
        capacity: s.capacity ?? null,
        evaluatorGroup: s.evaluatorGroup ?? null,
        evaluatorAudienceSpecJson: s.evaluatorAudienceSpec
          ? toJson(s.evaluatorAudienceSpec)
          : undefined,
      },
    });
  }
  return campaign;
}

export interface PublishResult {
  invitations: number;
}

/**
 * Resolves the audience into invitations (one per person and subject), schedules the window
 * jobs and subscribes the closing reminders. Tokens are minted by `openCampaign` when the
 * invitation is actually sent: a plaintext token exists only inside that one call.
 */
export async function publishCampaign(
  db: Db,
  campaignId: string,
  now: Date = new Date(),
): Promise<PublishResult> {
  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { subjects: true },
  });
  if (campaign.publishedAt) {
    return { invitations: await db.campaignInvitation.count({ where: { campaignId } }) };
  }
  const spec = fromJson<AudienceSpec>(campaign.audienceSpecJson);
  const loader = dbAudienceLoader(db, campaign.departmentId, now);

  const targets: Array<{ personId: string; subjectId: string | null }> = [];
  if (campaign.subjects.length) {
    for (const subject of campaign.subjects) {
      const evaluators = subject.evaluatorAudienceSpecJson
        ? await resolveAudienceIds(
            fromJson<AudienceSpec>(subject.evaluatorAudienceSpecJson),
            loader,
          )
        : await resolveAudienceIds(spec, loader);
      for (const personId of evaluators) targets.push({ personId, subjectId: subject.id });
    }
  } else {
    for (const personId of await resolveAudienceIds(spec, loader))
      targets.push({ personId, subjectId: null });
  }

  for (const t of targets) {
    // a placeholder hash no token can produce; openCampaign mints the real one
    await db.campaignInvitation.create({
      data: {
        departmentId: campaign.departmentId,
        campaignId,
        personId: t.personId,
        subjectId: t.subjectId,
        tokenHash: `unissued:${campaignId}:${t.personId}:${t.subjectId ?? ""}`,
        expiresAt: campaign.resolvedClosesAt,
      },
    });
  }

  const subject = { subjectType: "campaign", subjectId: campaignId };
  await enqueue(
    db,
    "campaign.open",
    { campaignId, departmentId: campaign.departmentId },
    {
      kind: "campaign_open",
      idempotencyKey: `campaign:${campaignId}:open`,
      singletonKey: `campaign:${campaignId}:open`,
      startAfter: campaign.resolvedOpensAt,
      departmentId: campaign.departmentId,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
    },
  );
  await enqueue(
    db,
    "campaign.close",
    { campaignId, departmentId: campaign.departmentId },
    {
      kind: "campaign_close",
      idempotencyKey: `campaign:${campaignId}:close`,
      singletonKey: `campaign:${campaignId}:close`,
      startAfter: campaign.resolvedClosesAt,
      departmentId: campaign.departmentId,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
    },
  );
  await subscribeReminders(db, campaign.departmentId, {
    subject,
    scheduleKey: campaign.reminderScheduleKey,
    deadline: { at: campaign.resolvedClosesAt },
    audienceSpec: { persons: Array.from(new Set(targets.map((t) => t.personId))) },
    variables: { title: campaign.title },
  });

  await db.campaign.update({ where: { id: campaignId }, data: { publishedAt: now } });
  await emit(
    db,
    "campaign.published",
    subject,
    { campaignId, invitations: targets.length },
    { departmentId: campaign.departmentId },
  );
  return { invitations: targets.length };
}

/**
 * Mints one token per not-yet-invited invitation and mails the link. Re-running is a no-op:
 * an invitation whose notification already exists keeps its token, so a link that was sent
 * stays valid.
 */
export async function openCampaign(
  db: Db,
  campaignId: string,
  now: Date = new Date(),
): Promise<number> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.closedAt) throw new CampaignError("This campaign is closed", "closed");
  const invitations = await db.campaignInvitation.findMany({
    where: { campaignId, status: "pending" },
  });
  let sent = 0;
  for (const invitation of invitations) {
    const dedupeKey = `campaign:${campaignId}:invite:${invitation.id}`;
    const already = await db.notification.findUnique({
      where: { dedupeKey: `${dedupeKey}:${invitation.personId}` },
    });
    if (already) continue;
    const token = newToken();
    await db.campaignInvitation.update({
      where: { id: invitation.id },
      data: { tokenHash: hashToken(token) },
    });
    const url = tokenUrl(token, env().BETTER_AUTH_URL);
    const result = await notify(db, campaign.departmentId, {
      recipients: [invitation.personId],
      templateKey: campaign.invitationTemplateKey,
      category: "campaign",
      subject: { subjectType: "campaign", subjectId: campaignId },
      actionUrl: url,
      dedupeKey,
      variables: {
        title: campaign.title,
        deadline: campaign.resolvedClosesAt.toISOString().slice(0, 10),
        action_url: url,
      },
      confirmMassSend: true,
    });
    sent += result.created.length;
  }
  await emit(
    db,
    "campaign.opened",
    { subjectType: "campaign", subjectId: campaignId },
    { campaignId, notified: sent, at: now.toISOString() },
    { departmentId: campaign.departmentId },
  );
  return sent;
}

/** Closes the window: expires open tokens, cancels reminders and queues the aggregation. */
export async function closeCampaign(
  db: Db,
  campaignId: string,
  now: Date = new Date(),
): Promise<{ expired: number }> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.closedAt) return { expired: 0 };
  const expired = await db.campaignInvitation.updateMany({
    where: { campaignId, status: { in: ["pending", "opened"] } },
    data: { status: "expired" },
  });
  const subject = { subjectType: "campaign", subjectId: campaignId };
  await cancelBySubject(db, subject);
  await cancelByPrefix(db, `campaign:${campaignId}:`);
  await db.campaign.update({
    where: { id: campaignId },
    data: { closedAt: now, resolvedClosesAt: campaign.resolvedClosesAt > now ? now : undefined },
  });
  await enqueue(
    db,
    "campaign.aggregate",
    { campaignId, departmentId: campaign.departmentId },
    {
      kind: "campaign_aggregate",
      idempotencyKey: `campaign:${campaignId}:aggregate:${now.toISOString().slice(0, 13)}`,
      departmentId: campaign.departmentId,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
    },
  );
  await emit(
    db,
    "campaign.closed",
    subject,
    { campaignId },
    { departmentId: campaign.departmentId },
  );
  return { expired: expired.count };
}

/** Re-resolves an anchored window and reschedules the jobs (calendar period moved). */
export async function rescheduleCampaign(db: Db, campaignId: string): Promise<boolean> {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.closedAt) return false;
  const window = fromJson<WindowAnchor>(campaign.windowAnchorJson);
  const { opensAt, closesAt } = await resolveWindow(db, campaign.termId, window);
  if (
    opensAt.getTime() === campaign.resolvedOpensAt.getTime() &&
    closesAt.getTime() === campaign.resolvedClosesAt.getTime()
  )
    return false;
  await db.campaign.update({
    where: { id: campaignId },
    data: { resolvedOpensAt: opensAt, resolvedClosesAt: closesAt },
  });
  await db.campaignInvitation.updateMany({
    where: { campaignId, status: { in: ["pending", "opened"] } },
    data: { expiresAt: closesAt },
  });
  await cancelByPrefix(db, `campaign:${campaignId}:`);
  if (campaign.publishedAt) {
    await enqueue(
      db,
      "campaign.open",
      { campaignId, departmentId: campaign.departmentId },
      {
        kind: "campaign_open",
        idempotencyKey: `campaign:${campaignId}:open:${opensAt.toISOString()}`,
        startAfter: opensAt,
        departmentId: campaign.departmentId,
        subjectType: "campaign",
        subjectId: campaignId,
      },
    );
    await enqueue(
      db,
      "campaign.close",
      { campaignId, departmentId: campaign.departmentId },
      {
        kind: "campaign_close",
        idempotencyKey: `campaign:${campaignId}:close:${closesAt.toISOString()}`,
        startAfter: closesAt,
        departmentId: campaign.departmentId,
        subjectType: "campaign",
        subjectId: campaignId,
      },
    );
    await subscribeReminders(db, campaign.departmentId, {
      subject: { subjectType: "campaign", subjectId: campaignId },
      scheduleKey: campaign.reminderScheduleKey,
      deadline: { at: closesAt },
      audienceSpec: {
        persons: (
          await db.campaignInvitation.findMany({
            where: { campaignId, status: { in: ["pending", "opened"] } },
            select: { personId: true },
          })
        ).map((i) => i.personId),
      },
      variables: { title: campaign.title },
    });
  }
  return true;
}

export interface OpenedLink {
  campaign: Awaited<ReturnType<typeof campaignOf>>;
  invitationId: string;
  personId: string;
  campaignSubjectId: string | null;
  editing: boolean;
  fields: ReturnType<typeof fieldsOf>;
  answers: AnswerMap;
}

export async function campaignOf(db: Db, campaignId: string) {
  return db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { form: { include: { questions: { orderBy: { order: "asc" } } } }, subjects: true },
  });
}

/**
 * The department that issued a token. The public `/c/[token]` route has no session and thus no
 * tenant context, while `campaign_invitation` is tenant-scoped: this one lookup therefore crosses
 * tenants under an audited bypass and reads nothing but the department, which the caller then
 * uses to open an ordinary tenant transaction. An unknown token is indistinguishable from a
 * token of another department: both answer `null`.
 */
export async function departmentOfToken(token: string): Promise<string | null> {
  const invitation = await withTenantBypass(
    { worker: true, jobName: "campaign.link" },
    "resolve a campaign invitation token",
    (tx) =>
      tx.campaignInvitation.findUnique({
        where: { tokenHash: hashToken(token) },
        select: { departmentId: true },
      }),
  );
  return invitation?.departmentId ?? null;
}

/** Resolves a public token into the form to render; marks the invitation opened. */
export async function openLink(db: Db, token: string, now: Date = new Date()): Promise<OpenedLink> {
  const invitation = await db.campaignInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!invitation) throw new CampaignError("This link is not valid", "not_found");
  const campaign = await campaignOf(db, invitation.campaignId);
  const verdict = checkToken(
    {
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      opensAt: campaign.resolvedOpensAt,
      closesAt: campaign.closedAt ?? campaign.resolvedClosesAt,
      submissionRule: campaign.submissionRule,
    },
    now,
  );
  if (!verdict.ok) {
    const message =
      verdict.reason === "used"
        ? "This invitation has already been used"
        : verdict.reason === "not_open"
          ? "This campaign has not opened yet"
          : verdict.reason === "closed"
            ? "This campaign is closed"
            : "This link has expired";
    throw new CampaignError(message, verdict.reason === "used" ? "used" : "expired");
  }
  if (invitation.status === "pending")
    await db.campaignInvitation.update({
      where: { id: invitation.id },
      data: { status: "opened" },
    });

  const fields = fieldsOf(campaign.form);
  let answers: AnswerMap = {};
  if (verdict.editing && campaign.anonymityMode === "identified") {
    const previous = await db.submission.findFirst({
      where: { campaignId: campaign.id, invitationId: invitation.id, status: "submitted" },
      include: { answers: true },
    });
    if (previous) answers = answersOf(previous.answers, fields);
  }
  return {
    campaign,
    invitationId: invitation.id,
    personId: invitation.personId,
    campaignSubjectId: invitation.subjectId,
    editing: verdict.editing,
    fields,
    answers,
  };
}

/** Cohort attributes kept with an identified/pseudonymous response (never the person itself). */
async function cohortOf(db: Db, personId: string): Promise<Record<string, unknown>> {
  const student = await db.student.findUnique({
    where: { personId },
    include: { program: true, sectionMemberships: { where: { validTo: null }, take: 1 } },
  });
  if (student)
    return {
      role: "student",
      program: student.program.code,
      admissionYear: student.admissionYear,
    };
  const staff = await db.staffProfile.findUnique({ where: { personId } });
  return staff ? { role: "staff", rank: staff.academicRank ?? "unknown" } : { role: "external" };
}

/**
 * Submits through a public token. Anonymity is structural: an anonymous campaign writes a
 * submission with no respondent and no invitation id, and the invitation is marked submitted
 * in a separate statement with a day-truncated timestamp.
 */
export async function submitViaToken(
  db: Db,
  token: string,
  answers: AnswerMap,
  now: Date = new Date(),
) {
  const link = await openLink(db, token, now);
  const campaign = link.campaign;
  const anonymous = campaign.anonymityMode === "anonymous";
  const pseudonymous = campaign.anonymityMode === "pseudonymous";
  const cohort = anonymous ? await cohortOf(db, link.personId) : await cohortOf(db, link.personId);

  const existing =
    !anonymous && link.editing
      ? await db.submission.findFirst({
          where: {
            campaignId: campaign.id,
            invitationId: link.invitationId,
            status: "submitted",
          },
        })
      : null;

  const submission = await submit(
    db,
    campaign.departmentId,
    campaign.form.key,
    answers,
    {
      campaignId: campaign.id,
      campaignSubjectId: link.campaignSubjectId,
      respondentPersonId: anonymous || pseudonymous ? null : link.personId,
      invitationId: anonymous ? null : link.invitationId,
      cohortAttributes: cohort,
      pseudonymHash: pseudonymous
        ? pseudonym(campaign.id, link.personId, env().BETTER_AUTH_SECRET)
        : null,
      dayTruncated: anonymous,
      formVersion: campaign.formVersion,
    },
    existing?.id,
  );

  const submittedAt = anonymous
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : now;
  await db.campaignInvitation.update({
    where: { id: link.invitationId },
    data: { status: "submitted", submittedAt },
  });
  return submission;
}

export async function participation(db: Db, campaignId: string) {
  const [invited, submitted, opened, responses] = await Promise.all([
    db.campaignInvitation.count({ where: { campaignId } }),
    db.campaignInvitation.count({ where: { campaignId, status: "submitted" } }),
    db.campaignInvitation.count({ where: { campaignId, status: "opened" } }),
    db.submission.count({ where: { campaignId, status: "submitted" } }),
  ]);
  return { invited, submitted, opened, responses };
}
