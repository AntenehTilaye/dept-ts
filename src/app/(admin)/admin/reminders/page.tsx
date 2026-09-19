import { adminPageContext } from "@/lib/auth/page";
import { prismaRoot } from "@/lib/db/prisma";
import { withTenantBypass } from "@/lib/db/tenant";
import { fromJson } from "@/lib/db/json";
import { dryRun } from "@/platform/scheduler/ledger";
import type { EscalationSpec, OffsetSpec } from "@/platform/scheduler/offsets";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField, fmtDateTime } from "@/components/forms/Field";
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
import { saveScheduleForm, sendTestReminderForm } from "./actions";

export const dynamic = "force-dynamic";

const DEFAULT_OFFSETS =
  "-7:deadline_reminder:in_app+email\n-1:deadline_reminder:in_app+email\n0:deadline_reminder:in_app+email\n1:deadline_overdue:in_app+email";

function offsetsText(json: unknown): string {
  return fromJson<OffsetSpec[]>(json as never)
    .map((o) => `${o.offsetDays}:${o.templateKey}:${o.channels.join("+")}`)
    .join("\n");
}

export default async function RemindersPage(props: PageProps<"/admin/reminders">) {
  const ctx = await adminPageContext();
  const params = await props.searchParams;
  const days = Number(params.days ?? 14) || 14;
  const departments = await prismaRoot.department.findMany({ orderBy: { code: "asc" } });
  const departmentId =
    typeof params.department === "string" && params.department
      ? params.department
      : (departments[0]?.id ?? "");
  const schedules = await prismaRoot.reminderSchedule.findMany({
    where: { departmentId: null },
    orderBy: { key: "asc" },
  });
  const editing =
    typeof params.edit === "string" ? schedules.find((s) => s.key === params.edit) : undefined;
  const esc = editing?.escalationJson ? fromJson<EscalationSpec>(editing.escalationJson) : null;
  const from = new Date();
  const to = new Date(from.getTime() + days * 86_400_000);
  const rows = departmentId
    ? await withTenantBypass(
        { isAdmin: true, user: { id: ctx.user.id } },
        "reminder dry run",
        (tx) => dryRun(tx, departmentId, from, to),
      )
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reminder schedules"
        description="Offsets, templates and escalation for deadline reminders; dry-run what would fire."
      />
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Reminder schedules</CardTitle>
              <CardDescription>
                Offsets in days relative to the deadline (negative = before), template and channels
                per offset.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Offsets</TableHead>
                    <TableHead>Escalation</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((s) => {
                    const offsets = fromJson<OffsetSpec[]>(s.offsetsJson);
                    const e = s.escalationJson ? fromJson<EscalationSpec>(s.escalationJson) : null;
                    return (
                      <TableRow key={s.id} data-testid={`schedule-${s.key}`}>
                        <TableCell className="font-mono text-xs">
                          {s.key} {s.isDefault ? <Badge variant="secondary">default</Badge> : null}
                        </TableCell>
                        <TableCell className="text-xs">
                          {offsets
                            .map(
                              (o) =>
                                `${o.offsetDays > 0 ? "+" : ""}${o.offsetDays}d ${o.templateKey} [${o.channels.join("+")}]`,
                            )
                            .join(" · ")}
                        </TableCell>
                        <TableCell className="text-xs">
                          {e ? `after ${e.afterOverdueDays}d → ${e.toRoleKey}` : "-"}
                        </TableCell>
                        <TableCell>
                          <a
                            className="text-xs underline"
                            href={`/admin/reminders?edit=${s.key}&department=${departmentId}&days=${days}`}
                          >
                            edit
                          </a>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{editing ? `Edit ${editing.key}` : "New schedule"}</CardTitle>
              <CardDescription>
                One offset per line: days:template:channels, e.g. -3:deadline_reminder:in_app+email
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={saveScheduleForm}
                submitLabel="Save schedule"
                successMessage="Schedule saved."
                className="grid gap-2"
                resetOnSuccess={!editing}
              >
                <Field name="key" label="Key" required defaultValue={editing?.key} />
                <div className="grid gap-1">
                  <label className="text-sm font-medium" htmlFor="offsets">
                    Offsets
                  </label>
                  <textarea
                    id="offsets"
                    name="offsets"
                    required
                    className="min-h-28 rounded-md border px-3 py-2 font-mono text-xs"
                    defaultValue={editing ? offsetsText(editing.offsetsJson) : DEFAULT_OFFSETS}
                  />
                </div>
                <Field
                  name="escalationDays"
                  label="Escalate after overdue days"
                  type="number"
                  min={1}
                  defaultValue={esc?.afterOverdueDays ?? ""}
                />
                <Field
                  name="escalationRole"
                  label="Escalate to role"
                  defaultValue={esc?.toRoleKey ?? ""}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="isDefault"
                    value="1"
                    defaultChecked={editing?.isDefault}
                  />{" "}
                  Default schedule
                </label>
              </ActionForm>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Dry run</CardTitle>
            <form method="get" className="flex flex-wrap items-end gap-2">
              <SelectField name="department" label="Department" defaultValue={departmentId}>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </SelectField>
              <Field
                name="days"
                label="Days ahead"
                type="number"
                defaultValue={days}
                min={1}
                max={365}
              />
              <Button type="submit" variant="outline">
                Run
              </Button>
            </form>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ActionForm
              action={sendTestReminderForm}
              submitLabel="Fire a test reminder now"
              successMessage="Test reminder scheduled; the department head receives it within seconds."
              className="flex items-end gap-2"
            >
              <input type="hidden" name="departmentId" value={departmentId} />
              <SelectField
                name="scheduleKey"
                label="Schedule"
                defaultValue="default_7_3_1_0_overdue"
              >
                {schedules.map((s) => (
                  <option key={s.id} value={s.key}>
                    {s.key}
                  </option>
                ))}
              </SelectField>
            </ActionForm>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fires at</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Subject</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-testid="dry-run-row">
                    <TableCell className="whitespace-nowrap text-xs">
                      {fmtDateTime(r.runAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.idempotencyKey}</TableCell>
                    <TableCell className="text-xs">
                      {r.subjectType} {r.subjectId}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-muted-foreground"
                      data-testid="dry-run-empty"
                    >
                      Nothing scheduled in the next {days} days.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
