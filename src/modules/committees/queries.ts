import type { Db } from "@/lib/db/types";

// What a committee has done, in one list. Every kernel already records its own part of it — the
// workflow logs a transition, a report is a submission, a discussion is a comment, evidence is a
// document link — so this asks each of them for the committee's rows and merges them by time
// rather than keeping an activity table nobody else would write to.

export type ActivityKind = "transition" | "report" | "comment" | "document" | "task";

export interface ActivityRow {
  kind: ActivityKind;
  at: Date;
  label: string;
  detail?: string | null;
  by?: string | null;
  href?: string | null;
}

/**
 * The merge itself: newest first, and a row with no time is dropped rather than floated to the
 * top, because an undated entry would claim to be the latest thing that happened.
 */
export function mergeActivity(sources: ActivityRow[][]): ActivityRow[] {
  return sources
    .flat()
    .filter((row) => row.at instanceof Date && !Number.isNaN(row.at.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

export interface ActivityOptions {
  deptSlug: string;
  limit?: number;
}

/** Everything that happened to a committee: its own process, its reports, its tasks and its papers. */
export async function activityHistory(
  db: Db,
  committeeId: string,
  opts: ActivityOptions,
): Promise<ActivityRow[]> {
  const limit = opts.limit ?? 40;
  const committee = await db.committee.findUnique({ where: { id: committeeId } });
  if (!committee) return [];

  const reports = await db.committeeReport.findMany({
    where: { committeeId },
    orderBy: { periodTo: "desc" },
    include: { author: { select: { fullName: true } } },
  });
  const recordIds = [committee.featureRecordId, ...reports.map((r) => r.featureRecordId)];

  const [transitions, comments, documents, tasks] = await Promise.all([
    db.workflowTransitionLog.findMany({
      where: { instance: { subjectType: "feature_record", subjectId: { in: recordIds } } },
      orderBy: { at: "desc" },
      take: limit,
    }),
    db.comment.findMany({
      where: {
        thread: {
          OR: [
            { subjectType: "committee", subjectId: committeeId },
            { subjectType: "feature_record", subjectId: { in: recordIds } },
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { author: { select: { fullName: true } } },
    }),
    db.documentLink.findMany({
      where: {
        OR: [
          { subjectType: "committee", subjectId: committeeId },
          { subjectType: "feature_record", subjectId: { in: recordIds } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { document: { select: { id: true, title: true } } },
    }),
    db.task.findMany({
      where: { contextType: "committee", contextId: committeeId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  return mergeActivity([
    transitions.map((t) => ({
      kind: "transition" as const,
      at: t.at,
      label: `${t.fromState} → ${t.toState}`,
      detail: t.comment,
      by: null,
    })),
    reports
      .filter((r) => r.submittedAt)
      .map((r) => ({
        kind: "report" as const,
        at: r.submittedAt!,
        label: `Report for ${r.periodFrom.toISOString().slice(0, 10)} to ${r.periodTo.toISOString().slice(0, 10)}`,
        by: r.author.fullName,
        href: `/d/${opts.deptSlug}/f/committee_report/${r.featureRecordId}`,
      })),
    comments.map((c) => ({
      kind: "comment" as const,
      at: c.createdAt,
      label: "Comment",
      detail: c.body.slice(0, 160),
      by: c.author.fullName,
    })),
    documents.map((d) => ({
      kind: "document" as const,
      at: d.createdAt,
      label: d.document.title,
      detail: d.slotKey,
    })),
    tasks.map((t) => ({
      kind: "task" as const,
      at: t.completedAt ?? t.createdAt,
      label: t.title,
      detail: t.completedAt ? "completed" : "assigned",
      href: t.featureRecordId ? `/d/${opts.deptSlug}/tasks/${t.featureRecordId}` : null,
    })),
  ]).slice(0, limit);
}

export interface CommitteeOverviewData {
  committee: {
    id: string;
    name: string;
    purpose: string | null;
    type: string | null;
    startDate: Date | null;
    endDate: Date | null;
    groupId: string;
    status: string;
  };
  members: { personId: string; fullName: string; roleInGroup: string }[];
  reports: {
    id: string;
    featureRecordId: string;
    periodFrom: Date;
    periodTo: Date;
    submittedAt: Date | null;
    author: string;
    state: string;
  }[];
  tasks: { id: string; featureRecordId: string | null; title: string; dueAt: Date | null; done: boolean }[];
}

/** Everything the committee's own page shows beside the process: who, what and when. */
export async function committeeOverview(
  db: Db,
  featureRecordId: string,
): Promise<CommitteeOverviewData | null> {
  const committee = await db.committee.findFirst({
    where: { featureRecordId },
    include: { group: true },
  });
  if (!committee) return null;

  const now = new Date();
  const [memberships, reports, tasks] = await Promise.all([
    db.groupMembership.findMany({
      where: {
        groupId: committee.groupId,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      include: { person: { select: { fullName: true } } },
    }),
    db.committeeReport.findMany({
      where: { committeeId: committee.id },
      orderBy: { periodTo: "desc" },
      include: { author: { select: { fullName: true } } },
    }),
    db.task.findMany({
      where: { contextType: "committee", contextId: committee.id },
      orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }],
      take: 20,
    }),
  ]);

  const states = new Map(
    (
      await db.featureRecord.findMany({
        where: { id: { in: reports.map((r) => r.featureRecordId) } },
        select: { id: true, currentStateKey: true },
      })
    ).map((r) => [r.id, r.currentStateKey]),
  );

  return {
    committee: {
      id: committee.id,
      name: committee.name,
      purpose: committee.purpose,
      type: committee.type,
      startDate: committee.startDate,
      endDate: committee.endDate,
      groupId: committee.groupId,
      status: committee.group.status,
    },
    members: memberships
      .map((m) => ({
        personId: m.personId,
        fullName: m.person.fullName,
        roleInGroup: m.roleInGroup,
      }))
      .sort(
        (a, b) =>
          Number(b.roleInGroup === "chair") - Number(a.roleInGroup === "chair") ||
          a.fullName.localeCompare(b.fullName),
      ),
    reports: reports.map((r) => ({
      id: r.id,
      featureRecordId: r.featureRecordId,
      periodFrom: r.periodFrom,
      periodTo: r.periodTo,
      submittedAt: r.submittedAt,
      author: r.author.fullName,
      state: states.get(r.featureRecordId) ?? "draft",
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      featureRecordId: t.featureRecordId,
      title: t.title,
      dueAt: t.dueAt,
      done: !!t.completedAt,
    })),
  };
}
