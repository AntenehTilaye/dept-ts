import Link from "next/link";
import type { Route } from "next";
import { SearchIcon } from "lucide-react";
import { dbOf, pageContext } from "@/lib/auth/page";
import { actorOf } from "@/lib/auth/require";
import { search } from "@/platform/search";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SegmentedLinks } from "@/components/patterns/SegmentedLinks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

// One box over everything the department holds, filtered to what the reader may open. The hits
// are grouped by what they are, because "a person named Abebe" and "a task about Abebe" are
// different answers to the same word.

const TYPE_LABELS: Record<string, string> = {
  person: "People",
  staff_profile: "Staff profiles",
  course: "Courses",
  course_offering: "Offerings",
  group: "Groups",
  task: "Tasks",
  document: "Documents",
  feature_record: "Records",
  campaign: "Campaigns",
  resource: "Rooms",
};

export default async function SearchPage(props: PageProps<"/d/[dept]/search">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);

  const query = typeof params.q === "string" ? params.q : "";
  const type = typeof params.type === "string" ? params.type : "";
  const hits = query
    ? await search(db, actorOf(ctx), query, { limit: 60, ...(type ? { types: [type] } : {}) })
    : [];

  const byType = new Map<string, typeof hits>();
  for (const hit of hits) byType.set(hit.subjectType, [...(byType.get(hit.subjectType) ?? []), hit]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Search"
        description="Everything the department holds that you are allowed to open."
      />

      <Card>
        <CardContent>
          <form className="flex flex-wrap items-end gap-2" method="get" action={`/d/${dept}/search`}>
            <div className="min-w-64 flex-1">
              <label className="sr-only" htmlFor="q">
                What are you looking for?
              </label>
              <Input
                id="q"
                name="q"
                defaultValue={query}
                placeholder="A name, a course code, a phrase in a document…"
                autoFocus
              />
            </div>
            <Button type="submit">
              <SearchIcon /> Search
            </Button>
          </form>
        </CardContent>
      </Card>

      {query && byType.size > 1 ? (
        <SegmentedLinks
          label="Kind"
          items={[
            {
              label: `Everything (${hits.length})`,
              href: `/d/${dept}/search?q=${encodeURIComponent(query)}` as Route,
              active: !type,
            },
            ...Array.from(byType.entries()).map(([key, group]) => ({
              label: `${TYPE_LABELS[key] ?? key} (${group.length})`,
              href: `/d/${dept}/search?q=${encodeURIComponent(query)}&type=${key}` as Route,
              active: type === key,
            })),
          ]}
        />
      ) : null}

      {!query ? (
        <EmptyState
          icon={<SearchIcon />}
          title="Nothing searched yet"
          hint="Type a name, a code or a phrase. Ctrl K opens the same box from any page."
        />
      ) : hits.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title={`Nothing matches “${query}”`}
          hint="Try fewer words, or a code rather than a description."
        />
      ) : (
        <div className="flex flex-col gap-6" data-testid="search-results">
          {Array.from(byType.entries()).map(([key, group]) => (
            <section key={key} className="flex flex-col gap-2" aria-label={TYPE_LABELS[key] ?? key}>
              <h2 className="text-sm font-medium text-muted-foreground">
                {TYPE_LABELS[key] ?? key}
              </h2>
              <ul className="flex flex-col gap-2">
                {group.map((hit) => (
                  <li
                    key={`${hit.subjectType}:${hit.subjectId}`}
                    data-testid={`hit-${hit.subjectType}`}
                    className="rounded-lg border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {hit.url ? (
                        <Link className="font-medium underline" href={hit.url as Route}>
                          {hit.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{hit.title}</span>
                      )}
                      <Badge variant="secondary">{TYPE_LABELS[key] ?? key}</Badge>
                    </div>
                    {hit.snippet ? (
                      <p className="mt-1 text-sm text-muted-foreground">{hit.snippet}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
