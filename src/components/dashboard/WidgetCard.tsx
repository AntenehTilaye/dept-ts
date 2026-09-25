import Link from "next/link";
import type { Route } from "next";
import type { Widget } from "@/platform/dashboard";
import { StatCard } from "@/components/patterns/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// One widget, rendered the same way whoever registered it: headline numbers first, then a short
// list, then the way through to the page that holds the rest. A widget that is a table belongs
// on a page, not here.

export function WidgetCard({ widget }: { widget: Widget }) {
  const hasRows = !!widget.rows?.length;
  return (
    <Card data-testid={`widget-${widget.key}`}>
      <CardHeader>
        <CardTitle>
          {widget.href ? (
            <Link className="underline-offset-2 hover:underline" href={widget.href as Route}>
              {widget.title}
            </Link>
          ) : (
            widget.title
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {widget.stats?.length ? (
          <div
            className={cn(
              "grid gap-3",
              widget.stats.length > 2 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2",
            )}
          >
            {widget.stats.map((stat) => (
              <StatCard
                key={stat.label}
                label={stat.label}
                value={stat.value}
                tone={stat.tone ?? "default"}
                {...(stat.href ? { href: stat.href as Route } : {})}
              />
            ))}
          </div>
        ) : null}

        {hasRows ? (
          <ul className="divide-y text-sm">
            {widget.rows!.map((row, index) => (
              <li key={`${row.label}-${index}`} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate">
                  {row.href ? (
                    <Link className="underline-offset-2 hover:underline" href={row.href as Route}>
                      {row.label}
                    </Link>
                  ) : (
                    row.label
                  )}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {row.value}
                  {row.meta ? <span className="ml-2 text-xs">{row.meta}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {!hasRows && !widget.stats?.length ? (
          <p className="text-sm text-muted-foreground">{widget.empty ?? "Nothing to show."}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
