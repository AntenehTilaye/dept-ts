import { z } from "zod";
import { globalSingleton } from "../../lib/singleton";
import { registerReport, type ReportContext, type ReportData } from "./registry";

// The three reports the framework ships with. They exist because every format has to be proven
// by something real — a page to read, a workbook to sort, a csv to load elsewhere — and because
// a department wants exactly these three on its first day.

const state = globalSingleton("system-reports", () => ({ installed: false }));

export function installSystemReports(): void {
  if (state.installed) return;
  state.installed = true;

  registerReport({
    key: "department_activity",
    title: "Department activity",
    description: "What the department did in a period: work finished, work outstanding, and who did it.",
    requiredPermission: "task.view",
    formats: ["pdf", "xlsx", "csv", "html"],
    parameters: z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
    parameterFields: [
      { name: "from", label: "From", type: "date" },
      { name: "to", label: "To", type: "date" },
    ],
    dataSource: departmentActivity,
  });

  registerReport({
    key: "task_list",
    title: "Task list",
    description: "Every task with its state, its people and its deadline.",
    requiredPermission: "task.view",
    formats: ["xlsx", "csv", "pdf", "html"],
    parameters: z.object({ state: z.string().optional() }),
    parameterFields: [
      {
        name: "state",
        label: "State",
        type: "select",
        options: [
          { value: "", label: "Every state" },
          { value: "open", label: "Still open" },
          { value: "completed", label: "Completed" },
        ],
      },
    ],
    dataSource: taskList,
  });

  registerReport({
    key: "audit_extract",
    title: "Audit extract",
    description: "The audit trail of a period, for somebody who has to answer for it.",
    requiredPermission: "admin.department",
    formats: ["csv", "html"],
    parameters: z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      subjectType: z.string().optional(),
    }),
    parameterFields: [
      { name: "from", label: "From", type: "date" },
      { name: "to", label: "To", type: "date" },
      { name: "subjectType", label: "About", type: "text" },
    ],
    dataSource: auditExtract,
  });
}

/** The period a report covers: what was asked for, or the last 30 days. */
function period(params: Record<string, unknown>): { from: Date; to: Date } {
  const to = params.to ? new Date(String(params.to)) : new Date();
  const from = params.from
    ? new Date(String(params.from))
    : new Date(to.getTime() - 30 * 86_400_000);
  return { from, to };
}

async function departmentActivity(ctx: ReportContext): Promise<ReportData> {
  const { from, to } = period(ctx.params);
  const department = await ctx.db.department.findUnique({
    where: { id: ctx.departmentId },
    select: { name: true },
  });

  const [tasks, records, people] = await Promise.all([
    ctx.db.task.findMany({
      where: { departmentId: ctx.departmentId, createdAt: { gte: from, lte: to } },
      include: { assignments: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    ctx.db.featureRecord.findMany({
      where: { departmentId: ctx.departmentId, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    ctx.db.person.findMany({
      where: { departments: { some: { departmentId: ctx.departmentId, leftAt: null } } },
      select: { id: true, fullName: true },
    }),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));

  const byState = new Map<string, number>();
  for (const record of records)
    byState.set(record.currentStateKey, (byState.get(record.currentStateKey) ?? 0) + 1);

  const completed = tasks.filter((t) => t.completedAt).length;
  const overdue = tasks.filter((t) => !t.completedAt && t.dueAt && t.dueAt < new Date()).length;

  return {
    title: "Department activity",
    subtitle: `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`,
    departmentName: department?.name,
    generatedAt: new Date(),
    stats: [
      { label: "Tasks started", value: tasks.length },
      { label: "Tasks completed", value: completed },
      { label: "Overdue now", value: overdue },
      { label: "Records created", value: records.length },
    ],
    tables: [
      {
        key: "tasks",
        title: "Tasks",
        columns: [
          { key: "title", label: "Task" },
          { key: "kind", label: "Kind" },
          { key: "assignees", label: "Assigned to" },
          { key: "due", label: "Due", type: "date" },
          { key: "completed", label: "Completed", type: "date" },
        ],
        rows: tasks.map((task) => ({
          title: task.title,
          kind: task.kind,
          assignees: task.assignments
            .map((a) => (a.assigneeType === "person" ? (nameOf.get(a.assigneeId) ?? "someone") : "a group"))
            .join(", "),
          due: task.dueAt,
          completed: task.completedAt,
        })),
      },
      {
        key: "records",
        title: "Records by state",
        columns: [
          { key: "state", label: "State" },
          { key: "count", label: "Records", type: "number" },
        ],
        rows: Array.from(byState.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([state, count]) => ({ state, count })),
      },
    ],
  };
}

async function taskList(ctx: ReportContext): Promise<ReportData> {
  const wanted = String(ctx.params.state ?? "");
  const tasks = await ctx.db.task.findMany({
    where: {
      departmentId: ctx.departmentId,
      ...(wanted === "open" ? { completedAt: null } : {}),
      ...(wanted === "completed" ? { completedAt: { not: null } } : {}),
    },
    include: { assignments: true },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: 2000,
  });
  // a task IS a feature record, and the record holds its state
  const records = await ctx.db.featureRecord.findMany({
    where: {
      id: { in: tasks.map((t) => t.featureRecordId).filter((id): id is string => !!id) },
    },
    select: { id: true, currentStateKey: true },
  });
  const stateOf = new Map(records.map((r) => [r.id, r.currentStateKey]));
  const people = await ctx.db.person.findMany({
    where: {
      id: {
        in: tasks.flatMap((t) =>
          t.assignments.filter((a) => a.assigneeType === "person").map((a) => a.assigneeId),
        ),
      },
    },
    select: { id: true, fullName: true },
  });
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));

  return {
    title: "Task list",
    subtitle: wanted ? `${wanted} tasks` : "every task",
    generatedAt: new Date(),
    stats: [{ label: "Tasks", value: tasks.length }],
    tables: [
      {
        key: "tasks",
        title: "Tasks",
        columns: [
          { key: "title", label: "Task" },
          { key: "state", label: "State" },
          { key: "priority", label: "Priority" },
          { key: "assignees", label: "Assigned to" },
          { key: "due", label: "Due", type: "date" },
        ],
        rows: tasks.map((task) => ({
          title: task.title,
          state:
            (task.featureRecordId ? stateOf.get(task.featureRecordId) : null) ??
            (task.completedAt ? "completed" : "open"),
          priority: task.priority,
          assignees: task.assignments
            .map((a) => (a.assigneeType === "person" ? (nameOf.get(a.assigneeId) ?? "someone") : "a group"))
            .join(", "),
          due: task.dueAt,
        })),
      },
    ],
  };
}

async function auditExtract(ctx: ReportContext): Promise<ReportData> {
  const { from, to } = period(ctx.params);
  const subjectType = String(ctx.params.subjectType ?? "");
  const events = await ctx.db.auditEvent.findMany({
    where: {
      departmentId: ctx.departmentId,
      at: { gte: from, lte: to },
      ...(subjectType ? { subjectType: subjectType as never } : {}),
    },
    orderBy: { at: "desc" },
    take: 5000,
  });

  return {
    title: "Audit extract",
    subtitle: `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}${
      subjectType ? ` · ${subjectType}` : ""
    }`,
    generatedAt: new Date(),
    stats: [{ label: "Events", value: events.length }],
    tables: [
      {
        key: "events",
        title: "Events",
        columns: [
          { key: "at", label: "When" },
          { key: "action", label: "Action" },
          { key: "subject", label: "About" },
          { key: "actor", label: "By" },
          { key: "reason", label: "Reason" },
        ],
        rows: events.map((event) => ({
          at: event.at.toISOString().slice(0, 19).replace("T", " "),
          action: event.action,
          subject: `${event.subjectType} ${event.subjectId}`,
          actor: event.actorUserId ?? "system",
          reason: event.reason ?? "",
        })),
      },
    ],
  };
}
