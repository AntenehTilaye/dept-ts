import Link from "next/link";
import { notFound } from "next/navigation";
import type { Route } from "next";
import { FileTextIcon } from "lucide-react";
import { dbOf, pageContext } from "@/lib/auth/page";
import { canDo } from "@/lib/auth/require";
import { actorOf } from "@/lib/auth/require";
import { FeatureNotFoundError, countsByState, featureCounters } from "@/platform/feature";
import { featureList, stateLabels } from "@/features/runtime/queries";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SegmentedLinks } from "@/components/patterns/SegmentedLinks";
import { StatCard } from "@/components/patterns/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

// The list page of every feature. Which columns, which filters and which views exist come from
// the published definition, so an administrator who adds a column sees it here without a release.

export default async function FeatureListPage(props: PageProps<"/d/[dept]/f/[featureKey]">) {
  const { dept, featureKey } = await props.params;
  const search = await props.searchParams;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);

  const one = (key: string) => {
    const value = search[key];
    return Array.isArray(value) ? value[0] : value;
  };

  let model;
  try {
    model = await featureList(db, ctx.departmentId, featureKey, {
      view: one("view") ?? null,
      personId: ctx.personId,
      filters: {
        states: one("state") ? [one("state")!] : undefined,
        presetKey: one("preset"),
        mine: one("mine") === "1",
        overdue: one("overdue") === "1",
      },
    });
  } catch (error) {
    if (error instanceof FeatureNotFoundError) notFound();
    throw error;
  }

  const { resolved, view, rows } = model;
  const canCreate = (await canDo(ctx, `feature.${featureKey}.create`, undefined, "submit")).allowed;
  const counters = (await featureCounters(db, ctx.departmentId, actorOf(ctx), dept)).filter(
    (c) => c.featureKey === featureKey,
  );
  const byState = await countsByState(db, ctx.departmentId, resolved.definitionId);
  const base = `/d/${dept}/f/${featureKey}`;
  const labels = stateLabels(resolved);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={resolved.def.labels.plural}
        description={resolved.def.description}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href={`${base}/new${one("preset") ? `?preset=${one("preset")}` : ""}` as Route}>
                New {resolved.def.labels.singular.toLowerCase()}
              </Link>
            </Button>
          ) : null
        }
      />

      {counters.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {counters.map((counter) => (
            <StatCard
              key={counter.key}
              label={counter.label}
              value={counter.count}
              href={counter.href as Route}
              tone={counter.tone === "neutral" ? "default" : counter.tone}
            />
          ))}
        </div>
      ) : null}

      {resolved.def.listViews.length > 1 ? (
        <SegmentedLinks
          label="Views"
          items={resolved.def.listViews.map((v) => ({
            label: v.label,
            href: `${base}?view=${v.key}` as Route,
            active: v.key === view.key,
          }))}
        />
      ) : null}

      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={<FileTextIcon />}
              title={`No ${resolved.def.labels.plural.toLowerCase()} yet`}
              hint={
                canCreate
                  ? `Use the "New ${resolved.def.labels.singular.toLowerCase()}" button to start one.`
                  : "Nothing here concerns you yet."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {view.columns.map((column) => (
                    <TableHead key={column.field}>{column.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid={`record-${row.id}`} data-number={row.number}>
                    {view.columns.map((column, i) => (
                      <TableCell key={column.field}>
                        {i === 0 ? (
                          <Link className="underline" href={`${base}/${row.id}` as Route}>
                            {cell(row, column.field)}
                          </Link>
                        ) : column.field === "state" ? (
                          <Badge variant="secondary">{row.stateLabel}</Badge>
                        ) : (
                          cell(row, column.field)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {Object.keys(byState).length ? (
        <p className="text-xs text-muted-foreground">
          {Object.entries(byState)
            .map(([state, count]) => `${labels[state] ?? state}: ${count}`)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function cell(row: Awaited<ReturnType<typeof featureList>>["rows"][number], field: string): string {
  switch (field) {
    case "number":
      return row.number;
    case "title":
      return row.title;
    case "state":
      return row.stateLabel;
    case "owner":
      return row.owner ?? "—";
    case "assignee":
      return row.assignee ?? "—";
    case "deadline":
      return row.deadline ? row.deadline.toISOString().slice(0, 10) : "—";
    case "createdAt":
      return row.createdAt.toISOString().slice(0, 10);
    case "preset":
      return row.presetKey ?? "—";
    default: {
      const value = row.data[field];
      if (value === null || value === undefined || value === "") return "—";
      return Array.isArray(value) ? value.join(", ") : String(value);
    }
  }
}
