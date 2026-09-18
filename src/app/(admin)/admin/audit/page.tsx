import { adminPageContext } from "@/lib/auth/page";
import { prismaRoot } from "@/lib/db/prisma";
import { withTenantBypass } from "@/lib/db/tenant";
import { SubjectType, AuditAction } from "@/generated/prisma/enums";
import { Field, SelectField, fmtDateTime } from "@/components/forms/Field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

function str(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (v instanceof Date) return v.toISOString();
  return typeof v === "string" ? v : JSON.stringify(v);
}

export default async function AuditPage(props: PageProps<"/admin/audit">) {
  const ctx = await adminPageContext();
  const p = await props.searchParams;
  const q = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : undefined);
  const subjectType = q("subjectType");
  const action = q("action");
  const actor = q("actor");
  const from = q("from") ? new Date(q("from")!) : undefined;
  const to = q("to") ? new Date(q("to")!) : undefined;

  const rows = await withTenantBypass(
    { isAdmin: true, user: { id: ctx.user.id } },
    "audit viewer",
    (tx) =>
      tx.auditEvent.findMany({
        where: {
          ...(subjectType ? { subjectType: subjectType as never } : {}),
          ...(action ? { action: action as never } : {}),
          ...(actor ? { actorUserId: actor } : {}),
          ...(from || to
            ? { at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
            : {}),
        },
        orderBy: { at: "desc" },
        take: 200,
      }),
  );
  const users = await prismaRoot.user.findMany({
    where: {
      id: {
        in: Array.from(new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))),
      },
    },
    select: { id: true, email: true },
  });
  const emailOf = new Map(users.map((u) => [u.id, u.email]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit trail</CardTitle>
        <CardDescription>
          Field-level changes, transitions, denials and tenant bypasses across the faculty (latest
          200).
        </CardDescription>
        <form method="get" className="grid gap-2 md:grid-cols-5">
          <SelectField
            name="subjectType"
            label="Subject type"
            defaultValue={subjectType ?? ""}
            emptyLabel="any"
          >
            {Object.values(SubjectType).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectField>
          <SelectField name="action" label="Action" defaultValue={action ?? ""} emptyLabel="any">
            {Object.values(AuditAction).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </SelectField>
          <Field name="actor" label="Actor user id" defaultValue={actor ?? ""} />
          <Field name="from" label="From" type="date" defaultValue={q("from") ?? ""} />
          <Field name="to" label="To" type="date" defaultValue={q("to") ?? ""} />
          <button type="submit" className="h-9 rounded-md border px-3 text-sm md:col-start-5">
            Filter
          </button>
        </form>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Changes / reason</TableHead>
              <TableHead>Correlation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const changes = (r.fieldChangesJson ?? {}) as Record<
                string,
                { before: unknown; after: unknown }
              >;
              return (
                <TableRow key={r.id} data-testid={`audit-${r.action}-${r.subjectType}`}>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.at)}</TableCell>
                  <TableCell className="text-xs">
                    {r.actorUserId ? (emailOf.get(r.actorUserId) ?? r.actorUserId) : "system"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.subjectType} {r.subjectId}
                    {r.departmentId ? (
                      <span className="text-muted-foreground"> · {r.departmentId}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.reason ? <p>{r.reason}</p> : null}
                    <ul>
                      {Object.entries(changes).map(([k, v]) => (
                        <li key={k}>
                          <span className="font-mono">{k}</span>: {str(v.before)} → {str(v.after)}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">
                    {r.correlationId?.slice(0, 8)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
