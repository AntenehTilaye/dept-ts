import { notFound } from "next/navigation";
import { adminPageContext } from "@/lib/auth/page";
import { withTenantBypass } from "@/lib/db/tenant";
import { FeatureDefinitionSchema, buildTree, type FeatureDefinition } from "@/platform/feature";
import { MigratePanel } from "@/components/admin/feature-builder/MigratePanel";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Moving running records onto a new version. Records pin the version they were created on, so
// this is a deliberate act with a map the administrator writes — a state with no home blocks its
// records rather than guessing where they belong.

export default async function MigratePage(props: PageProps<"/admin/features/[key]/migrate">) {
  const ctx = await adminPageContext();
  const { key } = await props.params;
  const bypass = { isAdmin: true as const, user: { id: ctx.user.id } };

  const data = await withTenantBypass(bypass, `migration of ${key}`, async (tx) => {
    const definition = await tx.featureDefinition.findFirst({ where: { key, departmentId: null } });
    if (!definition?.activeVersionId) return null;
    const versions = await tx.featureDefinitionVersion.findMany({
      where: { definitionId: definition.id, status: { in: ["published", "retired"] } },
      orderBy: { version: "desc" },
    });
    const active = versions.find((v) => v.id === definition.activeVersionId)!;
    const pinned = await tx.featureRecord.groupBy({
      by: ["departmentId", "definitionVersionId", "currentStateKey"],
      where: { definitionId: definition.id },
      _count: { _all: true },
    });
    const departments = await tx.department.findMany({ select: { id: true, name: true } });
    return { definition, versions, active, pinned, departments };
  });
  if (!data) notFound();

  const { definition, versions, active, pinned, departments } = data;
  const activeDef: FeatureDefinition = FeatureDefinitionSchema.parse(active.json);
  const tree = buildTree(activeDef);
  const targetStates = [
    ...tree.leaves.map((l) => l.step.key),
    ...tree.parallels.map((p) => p.group.key),
    ...activeDef.terminalStates.map((t) => t.key),
  ];
  const stale = pinned.filter((p) => p.definitionVersionId !== active.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[
          { label: "Features", href: "/admin/features" },
          { label: definition.name, href: `/admin/features/${key}` },
          { label: "Migrate" },
        ]}
        title={`Migrate ${definition.name}`}
        description={`Records still on an older version keep working; moving them is this page.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Where the records are</CardTitle>
          <CardDescription>
            Per department, per version, per state. The active version is v{active.version}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stale.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every record already renders from the active version.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {stale.map((row) => {
                const version = versions.find((v) => v.id === row.definitionVersionId);
                const department = departments.find((d) => d.id === row.departmentId);
                return (
                  <li
                    key={`${row.departmentId}-${row.definitionVersionId}-${row.currentStateKey}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span>
                      {department?.name ?? row.departmentId} ·{" "}
                      <span className="font-mono">{row.currentStateKey}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">v{version?.version ?? "?"}</Badge>
                      <span className="tabular-nums">{row._count._all}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <MigratePanel
        definitionId={definition.id}
        activeVersionId={active.id}
        versions={versions.map((v) => ({ id: v.id, version: v.version, status: v.status }))}
        departments={departments}
        targetStates={targetStates}
      />
    </div>
  );
}
