import { adminPageContext } from "@/lib/auth/page";
import { prismaRoot } from "@/lib/db/prisma";
import { withTenantBypass } from "@/lib/db/tenant";
import { listJobs } from "@/platform/scheduler/ledger";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, fmtDateTime } from "@/components/forms/Field";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cancelJobForm, replayEventForm, retryJobForm } from "./actions";

export const dynamic = "force-dynamic";

const STATUSES = ["scheduled", "sent", "running", "done", "failed", "cancelled"] as const;
const HEARTBEAT_SETTING_KEY = "worker.lastHeartbeat";

export default async function JobsPage(props: PageProps<"/admin/jobs">) {
  const ctx = await adminPageContext();
  const params = await props.searchParams;
  const status = STATUSES.find((s) => s === params.status);
  const now = new Date().getTime();
  const bypass = { isAdmin: true as const, user: { id: ctx.user.id } };
  const [heartbeat, jobs, backlog, dead] = await Promise.all([
    prismaRoot.systemSetting.findFirst({ where: { key: HEARTBEAT_SETTING_KEY, scope: "global" } }),
    withTenantBypass(bypass, "jobs ledger", (tx) =>
      listJobs(tx, { status: status ? [status] : undefined, limit: 100 }),
    ),
    withTenantBypass(bypass, "outbox backlog", (tx) =>
      tx.domainEvent.count({ where: { publishedAt: null, deadAt: null } }),
    ),
    withTenantBypass(bypass, "dead events", (tx) =>
      tx.domainEvent.findMany({
        where: { deadAt: { not: null } },
        orderBy: { occurredAt: "desc" },
        take: 20,
      }),
    ),
  ]);
  const last = typeof heartbeat?.valueJson === "string" ? new Date(heartbeat.valueJson) : null;
  const stale = !last || now - last.getTime() > 3 * 60_000;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jobs and worker"
        description="Background worker health, the scheduled-job ledger and events that could not be dispatched."
      />
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Worker</CardTitle>
            </CardHeader>
            <CardContent data-testid="worker-heartbeat">
              <Badge variant={stale ? "destructive" : "default"}>
                {stale ? "no recent heartbeat" : "alive"}
              </Badge>
              <p className="mt-2 text-xs text-muted-foreground">
                last heartbeat {last ? fmtDateTime(last) : "never"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Outbox backlog</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold" data-testid="outbox-backlog">
              {backlog}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Dead events</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{dead.length}</CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Scheduled jobs</CardTitle>
            <CardDescription>
              The ledger beside pg-boss: every deferred job with its idempotency key.
            </CardDescription>
            <form method="get" className="flex items-end gap-2">
              <SelectField
                name="status"
                label="Status"
                defaultValue={status ?? ""}
                emptyLabel="any"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </SelectField>
              <Button type="submit" variant="outline">
                Filter
              </Button>
            </form>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Runs at</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id} data-testid={`job-${j.kind}`}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {fmtDateTime(j.runAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{j.queue}</TableCell>
                    <TableCell className="font-mono text-xs">{j.idempotencyKey}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          j.status === "failed"
                            ? "destructive"
                            : j.status === "done"
                              ? "secondary"
                              : "default"
                        }
                      >
                        {j.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {j.lastError}
                    </TableCell>
                    <TableCell className="flex gap-1">
                      {j.status === "scheduled" || j.status === "sent" ? (
                        <ActionForm
                          action={cancelJobForm}
                          submitLabel="Cancel"
                          successMessage="Cancelled."
                          className="inline"
                        >
                          <input type="hidden" name="id" value={j.id} />
                        </ActionForm>
                      ) : null}
                      {j.status === "failed" ? (
                        <ActionForm
                          action={retryJobForm}
                          submitLabel="Retry"
                          successMessage="Re-sent."
                          className="inline"
                        >
                          <input type="hidden" name="id" value={j.id} />
                        </ActionForm>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {dead.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Dead events</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                {dead.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">
                      {e.name} {e.aggregateType}:{e.aggregateId} · {e.lastError}
                    </span>
                    <ActionForm
                      action={replayEventForm}
                      submitLabel="Replay"
                      successMessage="Replayed."
                      className="inline"
                    >
                      <input type="hidden" name="id" value={e.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
