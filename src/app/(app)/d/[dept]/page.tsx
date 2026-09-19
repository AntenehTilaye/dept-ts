import {
  BellIcon,
  BookOpenIcon,
  CalendarClockIcon,
  CheckSquareIcon,
  LayersIcon,
  UsersIcon,
} from "lucide-react";
import { dbOf, pageContext } from "@/lib/auth/page";
import { canDo } from "@/lib/auth/require";
import { navFor } from "@/lib/nav";
import { currentTerm } from "@/platform/academic/calendar";
import { inbox, unreadCount } from "@/platform/scheduler/inbox";
import { upcoming } from "@/platform/scheduler/upcoming";
import { fmtDate, fmtDateTime } from "@/components/forms/Field";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatCard } from "@/components/patterns/StatCard";
import { iconFor } from "@/components/shell/nav-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * Department overview: the numbers that matter today (progressive disclosure), the
 * person's own queue, and one tile per module they may open.
 */
export default async function DepartmentHome(props: PageProps<"/d/[dept]">) {
  const { dept } = await props.params;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);
  const base = `/d/${dept}`;
  const now = new Date();
  const [term, counts, latest, deadlines, nav, canSeeStaff, canSeeAcademic] = await Promise.all([
    currentTerm(db, ctx.departmentId),
    ctx.personId ? unreadCount(db, ctx.personId) : { unread: 0, pendingAck: 0 },
    ctx.personId ? inbox(db, ctx.personId, { limit: 5 }) : [],
    ctx.personId
      ? upcoming(db, ctx.departmentId, {
          personId: ctx.personId,
          from: now,
          to: new Date(now.getTime() + 14 * DAY),
        })
      : [],
    navFor(ctx),
    canDo(ctx, "staff.view", undefined, "read").then((r) => r.allowed),
    canDo(ctx, "academic.manage", undefined, "read").then((r) => r.allowed),
  ]);
  const [people, offerings, sections] = await Promise.all([
    canSeeStaff ? db.person.count({ where: { status: "active" } }) : null,
    canSeeAcademic && term ? db.courseOffering.count({ where: { termId: term.id } }) : null,
    canSeeAcademic ? db.section.count() : null,
  ]);
  const modules = nav.filter((n) => n.group === "Registry");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={ctx.departmentName}
        description={
          term
            ? `Current term ${term.name} (${fmtDate(term.startDate)} – ${fmtDate(term.endDate)}).`
            : "No current term is set yet; the calendar defines terms and periods."
        }
      >
        <div className="flex flex-wrap items-center gap-1.5" data-testid="role-keys">
          <span className="text-xs text-muted-foreground">Your roles:</span>
          {ctx.roleKeys.length ? (
            ctx.roleKeys.map((r) => (
              <Badge key={r} variant="secondary">
                {r}
              </Badge>
            ))
          ) : (
            <span className="text-xs">none</span>
          )}
        </div>
      </PageHeader>

      <section aria-label="At a glance" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Unread"
          value={counts.unread}
          hint={
            counts.pendingAck
              ? `${counts.pendingAck} waiting for your acknowledgement`
              : "Inbox is clear"
          }
          href={`${base}/inbox?filter=unread`}
          tone={counts.pendingAck ? "warning" : "default"}
          icon={<BellIcon />}
        />
        <StatCard
          label="Deadlines · 14 days"
          value={deadlines.length}
          hint={deadlines[0] ? `Next: ${fmtDateTime(deadlines[0].deadlineAt)}` : "Nothing due soon"}
          href={`${base}/upcoming`}
          icon={<CalendarClockIcon />}
        />
        {people !== null ? (
          <StatCard
            label="Active people"
            value={people}
            href={`${base}/people`}
            icon={<UsersIcon />}
          />
        ) : null}
        {offerings !== null ? (
          <StatCard
            label="Offerings this term"
            value={offerings}
            hint={sections !== null ? `${sections} sections` : undefined}
            href={`${base}/offerings`}
            icon={<BookOpenIcon />}
          />
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Latest in your inbox</CardTitle>
            <CardDescription>
              Notifications, duties and announcements addressed to you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!ctx.personId ? (
              <EmptyState
                compact
                title="Your account is not linked to a person record"
                hint="Nothing can be addressed to you until an administrator links your account."
              />
            ) : latest.length === 0 ? (
              <EmptyState
                compact
                icon={<CheckSquareIcon />}
                title="Nothing waiting for you"
                hint="Reminders, task assignments and duty notices arrive here."
              />
            ) : (
              <ul className="divide-y">
                {latest.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <a
                        href={`${base}/inbox`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {n.title}
                      </a>
                      <p className="line-clamp-1 text-xs text-muted-foreground">{n.body}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!n.readAt ? <Badge>new</Badge> : null}
                      {n.ackRequired && !n.acknowledgedAt && !n.declinedAt ? (
                        <Badge variant="outline">acknowledge</Badge>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Modules</CardTitle>
            <CardDescription>What you can open in {ctx.departmentName}.</CardDescription>
          </CardHeader>
          <CardContent>
            {modules.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {modules.map((m) => {
                  const Icon = iconFor(m.href.split("/").pop() ?? "");
                  return (
                    <li key={m.href}>
                      <a
                        href={m.href}
                        className="flex items-center gap-2 rounded-md border p-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                        <span>{m.label}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={<LayersIcon />}
                title="No modules for your roles yet"
                hint="Your inbox and upcoming deadlines are always available from the sidebar."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
