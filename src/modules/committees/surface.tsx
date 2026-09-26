import { can } from "@/platform/identity/can";
import { dbPolicyStore } from "@/platform/identity/policy-store";
import { registerSurface, type RecordExtras, type SurfaceContext } from "../surfaces";
import { issuesOf, summaryOf } from "./adapters";
import { activityHistory, committeeOverview } from "./queries";
import { ActivityHistory } from "./components/ActivityHistory";
import { CommitteeOverview } from "./components/CommitteeOverview";
import { IssueTable, type IssueRow } from "./components/IssueTable";

// What a committee and its reports show beyond the generic record page. Both are ordinary
// records — the process, the history and the documents are already rendered around this — so
// these are the two things the runtime cannot know: who is on the committee, and what became of
// the issues it raised.

export function registerCommitteeSurfaces(): void {
  registerSurface({ featureKey: "committee", recordExtras: committeeRecordExtras });
  registerSurface({ featureKey: "committee_report", recordExtras: reportRecordExtras });
}

async function committeeRecordExtras({
  ctx,
  db,
  record,
}: SurfaceContext): Promise<RecordExtras> {
  const data = await committeeOverview(db, record.id);
  if (!data) return {};

  const actor = {
    userId: ctx.user.id,
    personId: ctx.personId,
    departmentId: ctx.departmentId,
    isAdmin: ctx.isAdmin,
  };
  const subject = { subjectType: "committee", subjectId: data.committee.id };
  const [manage, report, staff, activity] = await Promise.all([
    can(dbPolicyStore, actor, "committee.manage", subject, { verb: "manage" }),
    can(dbPolicyStore, actor, "committee.report.submit", subject, { verb: "submit" }),
    db.staffProfile.findMany({
      include: { person: { select: { id: true, fullName: true } } },
      orderBy: { person: { fullName: "asc" } },
    }),
    activityHistory(db, data.committee.id, { deptSlug: ctx.deptSlug }),
  ]);

  return {
    slots: [
      {
        slotKey: "tor",
        label: "Terms of reference",
        required: true,
        satisfied: await hasSlot(db, record.id, "tor"),
        linkRole: "evidence",
      },
    ],
    slotSubject: { subjectType: "feature_record", subjectId: record.id },
    canUploadSlots: manage.allowed,
    slotsLabel: "Terms of reference",
    panels: [
      {
        key: "committee",
        label: "The committee",
        content: (
          <CommitteeOverview
            dept={ctx.deptSlug}
            data={data}
            staff={staff.map((s) => ({ personId: s.person.id, fullName: s.person.fullName }))}
            canManage={manage.allowed}
            canReport={report.allowed || manage.allowed}
          />
        ),
      },
      {
        key: "activity",
        label: "Activity",
        content: (
          <ActivityHistory
            rows={activity.map((row) => ({ ...row, at: row.at.toISOString() }))}
          />
        ),
      },
    ],
  };
}

async function reportRecordExtras({ ctx, db, record }: SurfaceContext): Promise<RecordExtras> {
  const issues = await issuesOf(db, record.id);
  const cases = await db.featureRecord.findMany({
    where: { parentSubjectType: "feature_record", parentSubjectId: record.id },
    select: { id: true, number: true, title: true },
  });
  const byTitle = new Map(cases.map((c) => [c.title, c]));
  const rows: IssueRow[] = issues.map((issue) => {
    const raised = byTitle.get(summaryOf(issue.text));
    return {
      text: issue.text,
      urgency: issue.urgency,
      caseNumber: raised?.number ?? null,
      caseRecordId: raised?.id ?? null,
    };
  });

  return {
    panels: [
      {
        key: "issues",
        label: `Issues${rows.length ? ` (${rows.length})` : ""}`,
        content: <IssueTable dept={ctx.deptSlug} rows={rows} />,
      },
    ],
  };
}

async function hasSlot(
  db: SurfaceContext["db"],
  recordId: string,
  slotKey: string,
): Promise<boolean> {
  const link = await db.documentLink.findFirst({
    where: { subjectType: "feature_record", subjectId: recordId, slotKey },
  });
  return !!link;
}
