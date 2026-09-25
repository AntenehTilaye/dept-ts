import { LayersIcon } from "lucide-react";
import { dbOf, pageContext } from "@/lib/auth/page";
import { actorOf } from "@/lib/auth/require";
import { navFor } from "@/lib/nav";
import { currentTerm } from "@/platform/academic/calendar";
import { getDashboard } from "@/platform/dashboard";
import { fmtDate } from "@/components/forms/Field";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { iconFor } from "@/components/shell/nav-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * The department's home page: the widgets this person's role asks for — a head opens it to see
 * the department, an instructor to see their own week — and then what they may open. Every
 * widget is registered rather than written here, so a module adds to this page by registering.
 */
export default async function DepartmentHome(props: PageProps<"/d/[dept]">) {
  const { dept } = await props.params;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);

  const [term, widgets, nav] = await Promise.all([
    currentTerm(db, ctx.departmentId),
    getDashboard({ db, actor: actorOf(ctx), departmentId: ctx.departmentId, deptSlug: dept }),
    navFor(ctx),
  ]);
  const modules = nav.filter((n) => n.group === "Registry" || n.group === "Work");

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

      {widgets.length ? (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="dashboard">
          {widgets.map((widget) => (
            <WidgetCard key={widget.key} widget={widget} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nothing on your dashboard yet"
          hint="Your inbox and upcoming deadlines are always available from the sidebar."
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>What you can open</CardTitle>
          <CardDescription>Everything your roles allow in {ctx.departmentName}.</CardDescription>
        </CardHeader>
        <CardContent>
          {modules.length ? (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((m) => {
                const Icon = iconFor(m.icon ?? (m.href.split("/").pop() ?? ""));
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
  );
}
