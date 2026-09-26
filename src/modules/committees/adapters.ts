import { globalSingleton } from "@/lib/singleton";
import type { Db } from "@/lib/db/types";
import { publish as emit } from "@/platform/audit/outbox";
import { act, availableActions } from "@/platform/feature/runtime/act";
import { createRecord } from "@/platform/feature/runtime/create";
import { registerFeatureEffect, registerFeatureGuard, registerStepAdapter } from "../register";

// What the two committee features actually do to the department's rows. The definitions say
// when; these say what. Nothing here decides who may act — that is the workflow's job — and
// nothing here writes a lifecycle column by hand: a task the report closes is walked through
// its own process, so its guards, its history and its notifications all still happen.

const state = globalSingleton("module-committees", () => ({ installed: false }));

/** The actions that take a `task` record from wherever it is to completed, in order. */
const CLOSING_ACTIONS = new Set(["start", "resume", "submit", "review", "approve"]);

/** The record's members field is a list of person ids; the chair is a member whatever it says. */
export function memberIdsOf(data: Record<string, unknown>): string[] {
  const raw = data.members;
  const members = Array.isArray(raw) ? raw.filter((m): m is string => typeof m === "string") : [];
  const chair = typeof data.chair === "string" && data.chair ? data.chair : null;
  return Array.from(new Set([...(chair ? [chair] : []), ...members]));
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const at = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Everyone who is on the committee right now, chair first. */
export async function currentMembers(
  db: Db,
  groupId: string,
): Promise<{ personId: string; fullName: string; roleInGroup: string }[]> {
  const now = new Date();
  const rows = await db.groupMembership.findMany({
    where: { groupId, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
    include: { person: { select: { fullName: true } } },
    orderBy: { person: { fullName: "asc" } },
  });
  return rows
    .map((m) => ({ personId: m.personId, fullName: m.person.fullName, roleInGroup: m.roleInGroup }))
    .sort((a, b) => Number(b.roleInGroup === "chair") - Number(a.roleInGroup === "chair"));
}

/**
 * Brings a committee's group membership in line with a list of people: whoever is on the list
 * stays or joins, whoever is not is closed off now, and the chair holds the chair. Every write
 * emits `group.membership.changed`, which is what the derived grants listen to.
 */
export async function syncMembership(
  tx: Db,
  departmentId: string,
  groupId: string,
  memberIds: string[],
  chairId: string | null,
  now = new Date(),
): Promise<void> {
  const open = await tx.groupMembership.findMany({
    where: { groupId, OR: [{ validTo: null }, { validTo: { gt: now } }] },
  });
  const wanted = new Set(memberIds);
  const touched: string[] = [];

  for (const row of open) {
    if (!wanted.has(row.personId)) {
      await tx.groupMembership.update({ where: { id: row.id }, data: { validTo: now } });
      touched.push(row.id);
      continue;
    }
    const role = row.personId === chairId ? "chair" : "member";
    if (row.roleInGroup !== role) {
      await tx.groupMembership.update({ where: { id: row.id }, data: { roleInGroup: role } });
      touched.push(row.id);
    }
    wanted.delete(row.personId);
  }

  for (const personId of wanted) {
    const created = await tx.groupMembership.create({
      data: {
        departmentId,
        groupId,
        personId,
        roleInGroup: personId === chairId ? "chair" : "member",
        validFrom: now,
      },
    });
    touched.push(created.id);
  }

  for (const membershipId of touched)
    await emit(
      tx,
      "group.membership.changed",
      { subjectType: "group_membership", subjectId: membershipId },
      { groupId },
      { departmentId },
    );
}

export function registerCommitteeAdapters(): void {
  if (state.installed) return;
  state.installed = true;

  registerStepAdapter(
    {
      key: "committee.backing",
      module: "committees",
      hook: "backing",
      description: "Creates the committee, its group and its membership from the record.",
    },
    async (ctx) => {
      if (!ctx.record) return;
      const data = ctx.record.data ?? {};
      const name =
        typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Committee";
      const chairId = typeof data.chair === "string" && data.chair ? data.chair : null;

      const group = await ctx.tx.group.create({
        data: { departmentId: ctx.departmentId, kind: "committee", name, status: "inactive" },
      });
      const committee = await ctx.tx.committee.create({
        data: {
          // the committee IS the record, so it carries the record's id: every page, link and
          // parent reference then names one thing by one id
          id: ctx.record.id,
          departmentId: ctx.departmentId,
          name,
          purpose: typeof data.purpose === "string" ? data.purpose : null,
          type: typeof data.type === "string" ? data.type : null,
          startDate: dateOf(data.start_date),
          endDate: dateOf(data.end_date),
          chairPersonId: chairId,
          groupId: group.id,
          responsibilitiesText:
            typeof data.responsibilities === "string" ? data.responsibilities : null,
          featureRecordId: ctx.record.id,
        },
      });
      // the group carries the committee as its context, so a membership of the group and a grant
      // scoped to the committee are the same fact seen from two sides
      await ctx.tx.group.update({
        where: { id: group.id },
        data: { contextType: "committee", contextId: committee.id },
      });
      await syncMembership(ctx.tx, ctx.departmentId, group.id, memberIdsOf(data), chairId);
      await emit(
        ctx.tx,
        "committee.changed",
        { subjectType: "committee", subjectId: committee.id },
        { name },
        { departmentId: ctx.departmentId },
      );
      return { committee_id: committee.id, group_id: group.id };
    },
  );

  registerStepAdapter(
    {
      key: "committee_report.backing",
      module: "committees",
      hook: "backing",
      description: "Creates the report row under the committee the record hangs from.",
    },
    async (ctx) => {
      if (!ctx.record) return;
      const record = await ctx.tx.featureRecord.findUniqueOrThrow({
        where: { id: ctx.record.id },
        select: { parentSubjectType: true, parentSubjectId: true, ownerPersonId: true },
      });
      if (record.parentSubjectType !== "committee" || !record.parentSubjectId)
        throw new Error("A committee report is always written under a committee");
      const data = ctx.record.data ?? {};
      const from = dateOf(data.period_from);
      const to = dateOf(data.period_to);
      if (!from || !to) throw new Error("A committee report covers a period");

      const report = await ctx.tx.committeeReport.create({
        data: {
          id: ctx.record.id,
          departmentId: ctx.departmentId,
          committeeId: record.parentSubjectId,
          periodFrom: from,
          periodTo: to,
          authorPersonId: record.ownerPersonId,
          featureRecordId: ctx.record.id,
        },
      });
      return { committee_report_id: report.id, committee_id: record.parentSubjectId };
    },
  );

  registerFeatureGuard(
    {
      key: "committee.chairIsMember",
      module: "committees",
      description: "A committee may not be constituted with a chair who is not on it.",
    },
    async (ctx) => {
      const committee = await ctx.tx.committee.findFirst({
        where: { featureRecordId: ctx.instance.subjectId },
      });
      if (!committee) return { ok: false, reason: "This record has no committee behind it." };
      if (!committee.chairPersonId) return { ok: false, reason: "The committee has no chair yet." };
      const member = await ctx.tx.groupMembership.findFirst({
        where: {
          groupId: committee.groupId,
          personId: committee.chairPersonId,
          OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
        },
      });
      return member ? true : { ok: false, reason: "The chair is not a member of the committee." };
    },
  );

  registerFeatureGuard(
    {
      key: "committee.memberGuard",
      module: "committees",
      description: "Only somebody on the committee may submit its report.",
    },
    async (ctx) => {
      const personId = ctx.actor?.personId;
      if (!personId) return { ok: false, reason: "Only a person can submit a report." };
      const report = await ctx.tx.committeeReport.findFirst({
        where: { featureRecordId: ctx.instance.subjectId },
        select: { committee: { select: { groupId: true } } },
      });
      if (!report) return { ok: false, reason: "This report has no committee behind it." };
      const member = await ctx.tx.groupMembership.findFirst({
        where: {
          groupId: report.committee.groupId,
          personId,
          OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
        },
      });
      return member ? true : { ok: false, reason: "Only a member of the committee may submit it." };
    },
  );

  registerFeatureEffect(
    {
      key: "committee.syncGroupStatus",
      module: "committees",
      description: "Opens or closes the committee's group with the state of the record.",
    },
    async (ctx) => {
      const committee = await ctx.tx.committee.findFirst({
        where: { featureRecordId: ctx.instance.subjectId },
      });
      if (!committee) return;
      const active = ctx.step.toState === "active";
      await ctx.tx.group.update({
        where: { id: committee.groupId },
        data: { status: active ? "active" : "inactive", deactivatedAt: active ? null : new Date() },
      });
      // the derived grants follow the group, so closing it expires every committee_member and
      // committee_chair grant the membership produced
      await emit(
        ctx.tx,
        "group.status.changed",
        { subjectType: "group", subjectId: committee.groupId },
        { status: active ? "active" : "inactive", committeeId: committee.id },
        { departmentId: ctx.instance.departmentId },
      );
    },
  );

  registerFeatureEffect(
    {
      key: "committee_report.setSubmittedAt",
      module: "committees",
      description: "Records when the report was handed in, and binds the answers to it.",
    },
    async (ctx) => {
      const report = await ctx.tx.committeeReport.findFirst({
        where: { featureRecordId: ctx.instance.subjectId },
      });
      if (!report) return;
      const step = await ctx.tx.featureStepInstance.findFirst({
        where: { recordId: ctx.instance.subjectId, submissionId: { not: null } },
        orderBy: { sequence: "desc" },
        select: { submissionId: true },
      });
      await ctx.tx.committeeReport.update({
        where: { id: report.id },
        data: {
          submittedAt: new Date(),
          ...(step?.submissionId && !report.submissionId
            ? { submissionId: step.submissionId }
            : {}),
        },
      });
    },
  );

  registerFeatureEffect(
    {
      key: "committee.completeReportedTasks",
      module: "committees",
      description: "Closes the committee tasks an approved report says were finished.",
    },
    async (ctx) => {
      const actor = ctx.actor;
      if (!actor) return;
      const record = await ctx.tx.featureRecord.findUnique({
        where: { id: ctx.instance.subjectId },
        select: { number: true },
      });
      const comment = `Reported as completed in ${record?.number ?? "a committee report"}`;
      for (const taskId of await answerRefs(ctx.tx, ctx.instance.subjectId, "completed_tasks")) {
        const taskRecord = await ctx.tx.featureRecord.findFirst({
          where: { taskId },
          select: { id: true, closedAt: true },
        });
        if (!taskRecord || taskRecord.closedAt) continue;
        // walk it through its own process rather than stamping the row: a guard that refuses
        // (a deliverable nobody handed in) leaves the task exactly where it was
        for (let hop = 0; hop < CLOSING_ACTIONS.size + 1; hop++) {
          const next = (await availableActions(ctx.tx, taskRecord.id, actor)).find(
            (action) => action.allowed && CLOSING_ACTIONS.has(action.key),
          );
          if (!next) break;
          await act(ctx.tx, taskRecord.id, next.stepKey, next.key, actor, { comment });
        }
      }
    },
  );

  registerFeatureEffect(
    {
      key: "committee.escalateIssueToCase",
      module: "committees",
      description: "Raises each unsettled issue of the report as a case for the department.",
    },
    async (ctx) => {
      const actor = ctx.actor;
      if (!actor) return;
      const issues = await issuesOf(ctx.tx, ctx.instance.subjectId);
      if (!issues.length) return;
      const raised = new Set(
        (
          await ctx.tx.featureRecord.findMany({
            where: {
              parentSubjectType: "feature_record",
              parentSubjectId: ctx.instance.subjectId,
            },
            select: { title: true },
          })
        ).map((r) => r.title),
      );
      for (const issue of issues) {
        const summary = summaryOf(issue.text);
        if (raised.has(summary)) continue;
        raised.add(summary);
        await createRecord(ctx.tx, ctx.instance.departmentId, actor, "case", {
          parentRef: { subjectType: "feature_record", subjectId: ctx.instance.subjectId },
          presetKey: "general",
          data: {
            summary,
            details: issue.text,
            category: "administrative",
          },
        });
      }
    },
  );
}

/** A case is titled by its summary, so the summary is what makes an issue recognisable. */
export function summaryOf(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 110 ? `${oneLine.slice(0, 107)}…` : oneLine;
}

/** The latest submission of a record: the answers the process is looking at right now. */
async function latestSubmissionId(tx: Db, recordId: string): Promise<string | null> {
  const step = await tx.featureStepInstance.findFirst({
    where: { recordId, submissionId: { not: null } },
    orderBy: { sequence: "desc" },
    select: { submissionId: true },
  });
  return step?.submissionId ?? null;
}

/** The picked references of one question of that submission. */
async function answerRefs(tx: Db, recordId: string, questionKey: string): Promise<string[]> {
  const submissionId = await latestSubmissionId(tx, recordId);
  if (!submissionId) return [];
  const answers = await tx.answer.findMany({
    where: { submissionId, questionStableKey: questionKey },
    select: { refId: true, valueJson: true },
  });
  const ids = new Set<string>();
  for (const answer of answers) {
    if (answer.refId) ids.add(answer.refId);
    else if (typeof answer.valueJson === "string" && answer.valueJson) ids.add(answer.valueJson);
  }
  return Array.from(ids);
}

/**
 * The repeating group of issues, as the head reads it on the report. A repeating group is stored
 * one row per sub-answer with the row number in `groupIndex`, so reading it is a regrouping.
 */
export async function issuesOf(
  tx: Db,
  recordId: string,
): Promise<{ text: string; urgency: string }[]> {
  const submissionId = await latestSubmissionId(tx, recordId);
  if (!submissionId) return [];
  const answers = await tx.answer.findMany({
    where: { submissionId, questionStableKey: { in: ["issue", "urgency"] } },
    orderBy: { groupIndex: "asc" },
    select: { questionStableKey: true, groupIndex: true, valueJson: true },
  });
  const rows = new Map<number, { text: string; urgency: string }>();
  for (const answer of answers) {
    const row = rows.get(answer.groupIndex) ?? { text: "", urgency: "normal" };
    const value = typeof answer.valueJson === "string" ? answer.valueJson : "";
    if (answer.questionStableKey === "issue") row.text = value.trim();
    else if (value) row.urgency = value;
    rows.set(answer.groupIndex, row);
  }
  return Array.from(rows.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row)
    .filter((row) => row.text.length > 0);
}
