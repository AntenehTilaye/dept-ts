import { notFound } from "next/navigation";
import { LockIcon } from "lucide-react";
import { adminPageContext } from "@/lib/auth/page";
import { withTenantBypass } from "@/lib/db/tenant";
import {
  FeatureDefinitionSchema,
  allLocks,
  buildTree,
  compile,
  publishContext,
  validateDefinition,
  type FeatureDefinition,
} from "@/platform/feature";
import { FeatureEditor } from "@/components/admin/feature-builder/FeatureEditor";
import { IssuesPanel } from "@/components/admin/feature-builder/IssuesPanel";
import { SimulatePanel } from "@/components/admin/feature-builder/SimulatePanel";
import { ActionForm } from "@/components/forms/ActionForm";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { publishVersionForm } from "../actions";

export const dynamic = "force-dynamic";

// One feature: what it is, what it compiles to, what is wrong with it and what a run of it would
// do. Everything here is the definition — the page has no knowledge of any particular process.

export default async function FeaturePage(props: PageProps<"/admin/features/[key]">) {
  const ctx = await adminPageContext();
  const { key } = await props.params;
  const bypass = { isAdmin: true as const, user: { id: ctx.user.id } };

  const data = await withTenantBypass(bypass, `read feature ${key}`, async (tx) => {
    const definition = await tx.featureDefinition.findFirst({
      where: { key, departmentId: null },
    });
    if (!definition) return null;
    const versions = await tx.featureDefinitionVersion.findMany({
      where: { definitionId: definition.id },
      orderBy: { version: "desc" },
    });
    const current =
      versions.find((v) => v.status === "draft") ??
      versions.find((v) => v.id === definition.activeVersionId) ??
      versions[0];
    if (!current) return null;
    const def: FeatureDefinition = FeatureDefinitionSchema.parse(current.json);
    const context = await publishContext(tx, definition.id, definition.isSystem, definition.departmentId);
    const records = await tx.featureRecord.count({ where: { definitionId: definition.id } });
    return { definition, versions, current, def, context, records };
  });
  if (!data) notFound();

  const { definition, versions, current, def, context, records } = data;
  const issues = validateDefinition(def, context);
  const compiled = compile(def, { isSystem: definition.isSystem, departmentId: definition.departmentId });
  const tree = buildTree(def);
  const locks = allLocks(def, definition.isSystem);
  const isDraft = current.status === "draft";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: "Features", href: "/admin/features" }, { label: definition.name }]}
        title={definition.name}
        description={
          <>
            <span className="font-mono">{definition.key}</span> · v{current.version} {current.status} ·{" "}
            {records} record{records === 1 ? "" : "s"}
            {definition.isSystem ? " · system feature" : ""}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {versions.slice(0, 4).map((v) => (
              <Badge key={v.id} variant={v.id === definition.activeVersionId ? "default" : "secondary"}>
                v{v.version} {v.status}
              </Badge>
            ))}
            {isDraft ? (
              <ActionForm
                action={publishVersionForm}
                submitLabel={`Publish v${current.version}`}
                successMessage="Published."
                className="inline"
                size="sm"
              >
                <input type="hidden" name="definitionId" value={definition.id} />
                <input type="hidden" name="versionId" value={current.id} />
              </ActionForm>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
            <CardDescription>
              What happens, in order. A locked badge means the code owns that part.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="divide-y text-sm" data-testid="step-tree">
              {tree.leaves.map((leaf) => (
                <li key={`${leaf.groupKey ?? ""}${leaf.step.key}`} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {leaf.groupKey ? `${leaf.groupKey} · ${leaf.branchKey} · ` : ""}
                      {leaf.step.label}
                    </span>
                    <span className="flex items-center gap-1">
                      {locks.some((l) => l.startsWith(leaf.path)) ? (
                        <Badge variant="outline" className="gap-1">
                          <LockIcon className="size-3" aria-hidden="true" /> locked
                        </Badge>
                      ) : null}
                      <Badge variant="secondary">{leaf.step.stepType}</Badge>
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{leaf.step.key}</span> ·{" "}
                    {leaf.step.actions.map((a) => `${a.label} → ${a.to}`).join(" · ")}
                  </p>
                </li>
              ))}
              {def.terminalStates.map((terminal) => (
                <li key={terminal.key} className="flex items-center justify-between gap-2 py-2">
                  <span className="font-medium">{terminal.label}</span>
                  <Badge variant={terminal.category === "success" ? "default" : "secondary"}>
                    {terminal.category}
                  </Badge>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What it compiles to</CardTitle>
            <CardDescription>The artefacts the other kernels will run.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>
              <span className="text-muted-foreground">Workflow</span>{" "}
              <span className="font-mono">{compiled.workflow.key}</span> ·{" "}
              {compiled.workflow.states.length} states · {compiled.workflow.transitions.length}{" "}
              transitions
            </p>
            <p>
              <span className="text-muted-foreground">Forms</span>{" "}
              {Object.values(compiled.forms).map((f) => f.key).join(", ") || "none"}
            </p>
            <p>
              <span className="text-muted-foreground">Tasks</span>{" "}
              {Object.values(compiled.taskTemplates).filter((t) => t.createTask).length} of{" "}
              {Object.keys(compiled.taskTemplates).length} steps create one
            </p>
            <p>
              <span className="text-muted-foreground">Permissions</span>{" "}
              {compiled.permissionKeys.length} keys · {compiled.rolePermissions.length} role rows
            </p>
            <p>
              <span className="text-muted-foreground">Grants needed</span>{" "}
              {compiled.grantRequirements.map((g) => `${g.roleKey}@${g.scopeType}`).join(", ") ||
                "none"}
            </p>
          </CardContent>
        </Card>
      </div>

      <IssuesPanel issues={issues} />

      <SimulatePanel definitionJson={JSON.stringify(def)} featureKey={def.key} />

      <FeatureEditor
        definitionId={definition.id}
        featureKey={def.key}
        json={JSON.stringify(def, null, 2)}
        locks={locks}
        isSystem={definition.isSystem}
      />
    </div>
  );
}
