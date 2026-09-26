import { z } from "zod";
import { globalSingleton } from "@/lib/singleton";
import { registerReport, type ReportContext, type ReportData } from "@/platform/reporting";
import { acknowledgements, assigneeDetail } from "@/platform/workitem";

// What a department asks a committee for on paper. Both of these are registrations, not code
// that makes files: the framework owns the formats, the storage and the queue, so a committee
// report differs from an audit extract only in the rows it gathers.

const state = globalSingleton("committee-reports", () => ({ installed: false }));

export function registerCommitteeReports(): void {
  if (state.installed) return;
  state.installed = true;

  registerReport({
    key: "committee",
    title: "Committee",
    description: "One committee in full: its members, its tasks, its reports and its papers.",
    requiredPermission: "committee.view",
    formats: ["pdf", "xlsx", "csv", "html"],
    featureKey: "committee",
    parameters: z.object({ committeeId: z.string().optional() }),
    parameterFields: [{ name: "committeeId", label: "Committee", type: "text", required: true }],
    dataSource: committeeReport,
  });

  registerReport({
    key: "committee_task",
    title: "Committee tasks",
    description: "Every task a committee holds, with who has it, when it is due and where it is.",
    requiredPermission: "committee.view",
    formats: ["xlsx", "csv", "pdf", "html"],
    featureKey: "committee",
    parameters: z.object({ committeeId: z.string().optional() }),
    parameterFields: [{ name: "committeeId", label: "Committee", type: "text" }],
    dataSource: committeeTasks,
  });
}

const day = (value: Date | null | undefined): string =>
  value ? value.toISOString().slice(0, 10) : "";

async function committeeRow(ctx: ReportContext, id: string | undefined) {
  if (!id) return null;
  // the committee and its record share an id, so a link from either page works here
  return ctx.db.committee.findFirst({
    where: { OR: [{ id }, { featureRecordId: id }] },
    include: { group: true, chair: { select: { fullName: true } } },
  });
}

async function committeeReport(ctx: ReportContext): Promise<ReportData> {
  const committee = await committeeRow(ctx, ctx.params.committeeId as string | undefined);
  if (!committee)
    return {
      title: "Committee",
      subtitle: "No committee was named",
      tables: [],
      generatedAt: new Date(),
    };

  const now = new Date();
  const [members, tasks, reports, documents, record] = await Promise.all([
    ctx.db.groupMembership.findMany({
      where: {
        groupId: committee.groupId,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      include: { person: { select: { fullName: true, email: true } } },
    }),
    ctx.db.task.findMany({
      where: { contextType: "committee", contextId: committee.id },
      orderBy: { createdAt: "asc" },
    }),
    ctx.db.committeeReport.findMany({
      where: { committeeId: committee.id },
      orderBy: { periodTo: "desc" },
      include: { author: { select: { fullName: true } } },
    }),
    ctx.db.documentLink.findMany({
      where: {
        OR: [
          { subjectType: "committee", subjectId: committee.id },
          { subjectType: "feature_record", subjectId: committee.featureRecordId },
        ],
      },
      include: { document: { select: { title: true, createdAt: true } } },
    }),
    ctx.db.featureRecord.findUnique({
      where: { id: committee.featureRecordId },
      select: { number: true, currentStateKey: true },
    }),
  ]);

  return {
    title: committee.name,
    subtitle: [committee.type, record?.number].filter(Boolean).join(" · "),
    generatedAt: new Date(),
    stats: [
      { label: "State", value: record?.currentStateKey ?? committee.group.status },
      { label: "Members", value: members.length },
      { label: "Tasks", value: tasks.length },
      { label: "Reports", value: reports.length },
    ],
    tables: [
      {
        key: "members",
        title: "Members",
        columns: [
          { key: "name", label: "Name" },
          { key: "role", label: "Role" },
          { key: "email", label: "Email" },
          { key: "since", label: "Member since", type: "date" },
        ],
        rows: members.map((m) => ({
          name: m.person.fullName,
          role: m.roleInGroup,
          email: m.person.email ?? "",
          since: day(m.validFrom),
        })),
      },
      {
        key: "tasks",
        title: "Tasks",
        columns: [
          { key: "title", label: "Task" },
          { key: "due", label: "Due", type: "date" },
          { key: "state", label: "State" },
        ],
        rows: tasks.map((t) => ({
          title: t.title,
          due: day(t.dueAt),
          state: t.completedAt ? "completed" : "open",
        })),
      },
      {
        key: "reports",
        title: "Reports",
        columns: [
          { key: "period", label: "Period" },
          { key: "author", label: "Written by" },
          { key: "submitted", label: "Submitted", type: "date" },
        ],
        rows: reports.map((r) => ({
          period: `${day(r.periodFrom)} to ${day(r.periodTo)}`,
          author: r.author.fullName,
          submitted: day(r.submittedAt),
        })),
      },
      {
        key: "documents",
        title: "Papers",
        columns: [
          { key: "title", label: "Document" },
          { key: "slot", label: "Kind" },
          { key: "at", label: "Filed", type: "date" },
        ],
        rows: documents.map((d) => ({
          title: d.document.title,
          slot: d.slotKey || d.linkRole,
          at: day(d.document.createdAt),
        })),
      },
    ],
    departmentName: committee.name,
  };
}

async function committeeTasks(ctx: ReportContext): Promise<ReportData> {
  const committee = await committeeRow(ctx, ctx.params.committeeId as string | undefined);
  const tasks = await ctx.db.task.findMany({
    where: committee
      ? { contextType: "committee", contextId: committee.id }
      : { contextType: "committee" },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
  });
  // who holds a task and who has said so are the work-item service's answers, not a join here
  const people = new Map(
    await Promise.all(
      tasks.map(
        async (t) =>
          [t.id, await assigneeDetail(ctx.db, t.id)] as const,
      ),
    ),
  );
  const acks = new Map(
    await Promise.all(
      tasks.map(async (t) => [t.id, await acknowledgements(ctx.db, t.id)] as const),
    ),
  );
  const records = new Map(
    (
      await ctx.db.featureRecord.findMany({
        where: { id: { in: tasks.map((t) => t.featureRecordId ?? "") } },
        select: { id: true, currentStateKey: true, number: true },
      })
    ).map((r) => [r.id, r]),
  );

  return {
    title: committee ? `${committee.name}: tasks` : "Committee tasks",
    generatedAt: new Date(),
    stats: [
      { label: "Tasks", value: tasks.length },
      { label: "Still open", value: tasks.filter((t) => !t.completedAt).length },
    ],
    tables: [
      {
        key: "tasks",
        title: "Tasks",
        columns: [
          { key: "number", label: "Number" },
          { key: "title", label: "Task" },
          { key: "assignees", label: "With" },
          { key: "due", label: "Due", type: "date" },
          { key: "state", label: "State" },
          { key: "acknowledged", label: "Acknowledged" },
        ],
        rows: tasks.map((t) => {
          const record = t.featureRecordId ? records.get(t.featureRecordId) : undefined;
          const ack = acks.get(t.id);
          return {
            number: record?.number ?? "",
            title: t.title,
            assignees: (people.get(t.id) ?? []).map((a) => a.name).join(", "),
            due: day(t.dueAt),
            state: record?.currentStateKey ?? (t.completedAt ? "completed" : "open"),
            acknowledged: ack ? `${ack.acknowledged}/${ack.total}` : "",
          };
        }),
      },
    ],
  };
}
