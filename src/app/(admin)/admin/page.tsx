import {
  ActivityIcon,
  BuildingIcon,
  FileTextIcon,
  MailWarningIcon,
  ShieldCheckIcon,
  UsersIcon,
  WorkflowIcon,
} from "lucide-react";
import { adminPageContext } from "@/lib/auth/page";
import { prismaRoot } from "@/lib/db/prisma";
import { withTenantBypass } from "@/lib/db/tenant";
import { fmtDateTime } from "@/components/forms/Field";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatCard } from "@/components/patterns/StatCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const HEARTBEAT_SETTING_KEY = "worker.lastHeartbeat";

/** Faculty-wide numbers plus the operational health an administrator checks first. */
export default async function AdminHome() {
  const ctx = await adminPageContext();
  const bypass = { isAdmin: true as const, user: { id: ctx.user.id } };
  const [users, departments, roles, templates, workflows, heartbeat, backlog, dead, recent] =
    await Promise.all([
      prismaRoot.user.count(),
      prismaRoot.department.count(),
      prismaRoot.role.count({ where: { departmentId: null } }),
      prismaRoot.template.count(),
      prismaRoot.workflowDefinition.count(),
      prismaRoot.systemSetting.findFirst({
        where: { key: HEARTBEAT_SETTING_KEY, scope: "global" },
      }),
      withTenantBypass(bypass, "admin overview", (tx) =>
        tx.domainEvent.count({ where: { publishedAt: null, deadAt: null } }),
      ),
      withTenantBypass(bypass, "admin overview", (tx) =>
        tx.domainEvent.count({ where: { deadAt: { not: null } } }),
      ),
      withTenantBypass(bypass, "admin overview", (tx) =>
        tx.auditEvent.findMany({
          // people, not the worker's own bypasses (outbox dispatch) or this page's read
          where: {
            action: { in: ["tenant_bypass", "login", "permission_change"] },
            actorUserId: { not: null },
            NOT: [{ reason: "admin overview" }, { reason: { startsWith: "outbox" } }],
          },
          orderBy: { at: "desc" },
          take: 8,
        }),
      ),
    ]);
  const last = typeof heartbeat?.valueJson === "string" ? new Date(heartbeat.valueJson) : null;
  const stale = !last || new Date().getTime() - last.getTime() > 3 * 60_000;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Administration"
        description="Faculty-wide accounts, access and configuration, and the health of the background worker."
      />
      <section aria-label="Health" className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Worker"
          value={
            <Badge variant={stale ? "destructive" : "default"} className="text-sm">
              {stale ? "no recent heartbeat" : "alive"}
            </Badge>
          }
          hint={last ? `Last heartbeat ${fmtDateTime(last)}` : "Never seen"}
          href="/admin/jobs"
          tone={stale ? "danger" : "success"}
          icon={<ActivityIcon />}
        />
        <StatCard
          label="Outbox backlog"
          value={backlog}
          hint="Events waiting to be dispatched"
          href="/admin/jobs"
          tone={backlog > 100 ? "warning" : "default"}
          icon={<MailWarningIcon />}
        />
        <StatCard
          label="Dead events"
          value={dead}
          hint={dead ? "Need a replay or a fix" : "Nothing stuck"}
          href="/admin/jobs"
          tone={dead ? "danger" : "default"}
          icon={<MailWarningIcon />}
        />
      </section>
      <section aria-label="Directory" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Users" value={users} href="/admin/users" icon={<UsersIcon />} />
        <StatCard
          label="Departments"
          value={departments}
          href="/admin/departments"
          icon={<BuildingIcon />}
        />
        <StatCard
          label="Faculty roles"
          value={roles}
          href="/admin/permissions"
          icon={<ShieldCheckIcon />}
        />
        <StatCard
          label="Templates"
          value={templates}
          href="/admin/templates"
          icon={<FileTextIcon />}
        />
        <StatCard
          label="Workflows"
          value={workflows}
          href="/admin/workflows"
          icon={<WorkflowIcon />}
        />
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Recent privileged activity</CardTitle>
          <CardDescription>
            Tenant bypasses and permission changes; the full trail is under Audit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No privileged activity recorded yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {recent.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <Badge variant="outline" className="mr-2 font-mono">
                      {e.action}
                    </Badge>
                    {e.subjectType} {e.reason ? `· ${e.reason}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {fmtDateTime(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
