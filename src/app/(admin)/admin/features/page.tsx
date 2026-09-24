import Link from "next/link";
import type { Route } from "next";
import { BlocksIcon } from "lucide-react";
import { adminPageContext } from "@/lib/auth/page";
import { withTenantBypass } from "@/lib/db/tenant";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Badge } from "@/components/ui/badge";
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

// Every process in the faculty, and whether it is waiting for something. A "system update
// pending" badge means a release changed the code-backed part of a built-in and left a draft
// that merges it into whatever the administrator had edited.

export default async function FeaturesPage() {
  const ctx = await adminPageContext();
  const bypass = { isAdmin: true as const, user: { id: ctx.user.id } };

  const { definitions, versions, counts } = await withTenantBypass(bypass, "list features", async (tx) => {
    const definitions = await tx.featureDefinition.findMany({
      orderBy: [{ navGroup: "asc" }, { navOrder: "asc" }],
    });
    const versions = await tx.featureDefinitionVersion.findMany({
      where: { definitionId: { in: definitions.map((d) => d.id) } },
      orderBy: { version: "desc" },
    });
    const counts = await tx.featureRecord.groupBy({
      by: ["definitionId"],
      _count: { _all: true },
    });
    return { definitions, versions, counts };
  });

  const recordsById = new Map(counts.map((c) => [c.definitionId, c._count._all]));
  const versionsById = new Map<string, typeof versions>();
  for (const version of versions)
    versionsById.set(version.definitionId, [...(versionsById.get(version.definitionId) ?? []), version]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Features"
        description="Every process in the faculty: what it is called, which version is live and whether a release is waiting to be published."
      />

      <Card>
        <CardHeader>
          <CardTitle>Published and draft features</CardTitle>
          <CardDescription>
            A system feature is backed by code: its labels, steps and notifications may be edited,
            the parts that name TypeScript may not.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {definitions.length === 0 ? (
            <EmptyState
              icon={<BlocksIcon />}
              title="No features yet"
              hint="The built-ins arrive with the seed; new ones are composed here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Versions</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {definitions.map((definition) => {
                  const own = versionsById.get(definition.id) ?? [];
                  const active = own.find((v) => v.id === definition.activeVersionId);
                  const pending = own.find(
                    (v) => v.status === "draft" && v.changeNote?.startsWith("seed-upgrade:"),
                  );
                  const draft = own.find((v) => v.status === "draft");
                  return (
                    <TableRow key={definition.id} data-testid={`feature-${definition.key}`}>
                      <TableCell className="font-medium">
                        <Link className="underline" href={`/admin/features/${definition.key}` as Route}>
                          {definition.name}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{definition.key}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {definition.departmentId ?? "faculty"}
                      </TableCell>
                      <TableCell className="flex flex-wrap gap-1">
                        {active ? <Badge>v{active.version} published</Badge> : null}
                        {draft && draft.id !== active?.id ? (
                          <Badge variant="secondary">v{draft.version} draft</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {recordsById.get(definition.id) ?? 0}
                      </TableCell>
                      <TableCell className="flex flex-wrap gap-1">
                        {definition.isSystem ? <Badge variant="outline">system</Badge> : null}
                        {pending ? (
                          <Badge variant="destructive" data-testid="system-update-pending">
                            system update pending
                          </Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
