import { globalSingleton } from "../../lib/singleton";
import { featureCounters } from "../feature";
import { upcoming } from "../scheduler/upcoming";
import { unreadCount } from "../scheduler/inbox";
import { myWork } from "../workitem";
import { readProjection } from "./projections/registry";
import { registerLayout } from "./layouts";
import { registerWidget, type Widget, type WidgetContext } from "./widgets";

// The widgets the platform ships with: what is on my plate, what is coming, what is waiting for
// me to act, and — for whoever runs the department — how the department as a whole is doing.

const state = globalSingleton("built-in-widgets", () => ({ installed: false }));

export function installBuiltInWidgets(): void {
  if (state.installed) return;
  state.installed = true;

  registerWidget({ key: "myWork", build: myWorkWidget });
  registerWidget({ key: "upcoming", build: upcomingWidget });
  registerWidget({ key: "inbox", build: inboxWidget });
  registerWidget({ key: "featureCounters", build: featureCountersWidget });
  registerWidget({ key: "departmentLoad", permission: "task.manage", build: departmentLoadWidget });
  registerWidget({ key: "pendingWork", permission: "task.manage", build: pendingWidget });
  registerWidget({ key: "campaigns", permission: "campaign.manage", build: campaignsWidget });

  // who opens the page to see the department, and who opens it to see their own week
  registerLayout({
    role: "department_head",
    widgets: ["departmentLoad", "pendingWork", "featureCounters", "myWork", "campaigns", "upcoming"],
  });
  registerLayout({
    role: "deputy_head",
    widgets: ["departmentLoad", "pendingWork", "featureCounters", "myWork", "upcoming"],
  });
  registerLayout({
    role: "committee_chair",
    widgets: ["myWork", "featureCounters", "upcoming", "inbox"],
  });
  registerLayout({ role: "default", widgets: ["myWork", "upcoming", "inbox", "featureCounters"] });
}

async function myWorkWidget(ctx: WidgetContext): Promise<Widget | null> {
  if (!ctx.actor.personId) return null;
  const rows = await myWork(ctx.db, ctx.departmentId, ctx.actor.personId);
  const overdue = rows.filter((r) => r.overdue).length;
  return {
    key: "myWork",
    title: "My work",
    href: `/d/${ctx.deptSlug}/my-work`,
    stats: [
      { label: "Open", value: rows.length, href: `/d/${ctx.deptSlug}/my-work` },
      {
        label: "Overdue",
        value: overdue,
        tone: overdue ? "danger" : "default",
        href: `/d/${ctx.deptSlug}/my-work?filter=overdue`,
      },
    ],
    rows: rows.slice(0, 5).map((task) => ({
      label: task.title,
      value: task.stateLabel ?? "—",
      meta: task.dueAt ? `due ${task.dueAt.toISOString().slice(0, 10)}` : undefined,
      href: `/d/${ctx.deptSlug}/tasks/${task.recordId ?? task.id}`,
    })),
    empty: "Nothing is assigned to you.",
  };
}

async function upcomingWidget(ctx: WidgetContext): Promise<Widget | null> {
  if (!ctx.actor.personId) return null;
  const now = new Date();
  const items = await upcoming(ctx.db, ctx.departmentId, {
    personId: ctx.actor.personId,
    from: now,
    to: new Date(now.getTime() + 14 * 86_400_000),
  });
  return {
    key: "upcoming",
    title: "Next two weeks",
    href: `/d/${ctx.deptSlug}/upcoming`,
    rows: items.slice(0, 6).map((item) => ({
      label: String(item.variables.title ?? item.variables.record_title ?? item.subjectType),
      value: item.deadlineAt.toISOString().slice(0, 10),
      meta: item.scheduleKey,
    })),
    empty: "Nothing is due in the next fortnight.",
  };
}

async function inboxWidget(ctx: WidgetContext): Promise<Widget | null> {
  if (!ctx.actor.personId) return null;
  const counts = await unreadCount(ctx.db, ctx.actor.personId);
  return {
    key: "inbox",
    title: "Inbox",
    href: `/d/${ctx.deptSlug}/inbox`,
    stats: [
      { label: "Unread", value: counts.unread, href: `/d/${ctx.deptSlug}/inbox?filter=unread` },
      {
        label: "Waiting for you",
        value: counts.pendingAck,
        tone: counts.pendingAck ? "warning" : "default",
        href: `/d/${ctx.deptSlug}/inbox?filter=ack`,
      },
    ],
  };
}

async function featureCountersWidget(ctx: WidgetContext): Promise<Widget | null> {
  const counters = await featureCounters(ctx.db, ctx.departmentId, ctx.actor, ctx.deptSlug);
  if (!counters.length) return null;
  return {
    key: "featureCounters",
    title: "Your processes",
    stats: counters.map((counter) => ({
      label: counter.label,
      value: counter.count,
      href: counter.href,
      tone: counter.tone === "neutral" ? "default" : counter.tone,
    })),
  };
}

async function departmentLoadWidget(ctx: WidgetContext): Promise<Widget | null> {
  const rows = await readProjection(ctx.db, ctx.departmentId, "openWork");
  if (!rows.length) return null;
  const people = await ctx.db.person.findMany({
    where: { id: { in: rows.map((r) => String(r.dimensions.personId ?? "")) } },
    select: { id: true, fullName: true },
  });
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
  const busiest = [...rows].sort((a, b) => (b.values.open ?? 0) - (a.values.open ?? 0)).slice(0, 6);

  return {
    key: "departmentLoad",
    title: "Who is carrying what",
    stats: [
      {
        label: "Open items",
        value: rows.reduce((sum, r) => sum + (r.values.open ?? 0), 0),
      },
      {
        label: "Overdue",
        value: rows.reduce((sum, r) => sum + (r.values.overdue ?? 0), 0),
        tone: rows.some((r) => r.values.overdue) ? "danger" : "default",
      },
    ],
    rows: busiest.map((row) => ({
      label: nameOf.get(String(row.dimensions.personId ?? "")) ?? "somebody",
      value: `${row.values.open ?? 0} open`,
      meta: row.values.overdue ? `${row.values.overdue} overdue` : undefined,
    })),
    empty: "Nothing is assigned to anybody.",
  };
}

async function pendingWidget(ctx: WidgetContext): Promise<Widget | null> {
  const rows = await readProjection(ctx.db, ctx.departmentId, "pendingByFeature");
  if (!rows.length) return null;
  return {
    key: "pendingWork",
    title: "Open by process",
    rows: rows
      .sort((a, b) => (b.values.open ?? 0) - (a.values.open ?? 0))
      .slice(0, 6)
      .map((row) => ({
        label: String(row.dimensions.name ?? row.dimensions.featureKey ?? "process"),
        value: `${row.values.open ?? 0} open`,
        meta: row.values.overdue ? `${row.values.overdue} overdue` : undefined,
        href: `/d/${ctx.deptSlug}/f/${String(row.dimensions.featureKey ?? "")}`,
      })),
    empty: "No process has anything open.",
  };
}

async function campaignsWidget(ctx: WidgetContext): Promise<Widget | null> {
  const rows = await readProjection(ctx.db, ctx.departmentId, "campaignProgress");
  if (!rows.length) return null;
  return {
    key: "campaigns",
    title: "Campaigns",
    rows: rows.slice(0, 5).map((row) => ({
      label: String(row.dimensions.title ?? "campaign"),
      value: `${row.values.submitted ?? 0}/${row.values.invited ?? 0} answered`,
      meta: row.values.pending ? `${row.values.pending} waiting` : undefined,
    })),
    empty: "No campaign is running.",
  };
}
