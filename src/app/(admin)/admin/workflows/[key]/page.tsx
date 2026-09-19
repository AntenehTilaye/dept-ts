import { notFound } from "next/navigation";
import { adminPageContext } from "@/lib/auth/page";
import { prismaRoot } from "@/lib/db/prisma";
import { versionsOf } from "@/platform/workflow/registry";
import { StateGraph } from "@/components/workflow/StateGraph";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function diffKeys(a: unknown, b: unknown): string[] {
  const out: string[] = [];
  const ka = new Map(((a as Array<{ key: string }>) ?? []).map((x) => [x.key, JSON.stringify(x)]));
  const kb = new Map(((b as Array<{ key: string }>) ?? []).map((x) => [x.key, JSON.stringify(x)]));
  for (const [k, v] of kb) {
    if (!ka.has(k)) out.push(`+ ${k}`);
    else if (ka.get(k) !== v) out.push(`~ ${k}`);
  }
  for (const k of ka.keys()) if (!kb.has(k)) out.push(`- ${k}`);
  return out;
}

export default async function WorkflowPage(props: PageProps<"/admin/workflows/[key]">) {
  await adminPageContext();
  const { key } = await props.params;
  const params = await props.searchParams;
  const versions = await versionsOf(prismaRoot, decodeURIComponent(key));
  if (versions.length === 0) notFound();
  const selected =
    versions.find((v) => String(v.version) === params.v) ??
    versions.find((v) => v.status === "active") ??
    versions[0]!;
  const previous = versions.find(
    (v) => v.version === selected.version - 1 && v.departmentId === selected.departmentId,
  );
  const raw = await prismaRoot.workflowDefinition.findMany({
    where: { key: selected.key },
    orderBy: { version: "desc" },
  });
  const selRaw = raw.find((r) => r.id === selected.id)!;
  const prevRaw = previous ? raw.find((r) => r.id === previous.id) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: "Workflows", href: "/admin/workflows" }, { label: selected.key }]}
        title={<span className="font-mono">{selected.key}</span>}
        description={
          <>
            {selected.definition.subjectType} · initial state {selected.definition.initialState} ·{" "}
            {selected.departmentId ?? "faculty-wide"} · editing happens in the feature builder
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        {versions.map((v) => (
          <a key={v.id} href={`/admin/workflows/${encodeURIComponent(v.key)}?v=${v.version}`}>
            <Badge variant={v.id === selected.id ? "default" : "secondary"}>
              v{v.version} {v.status} {v.departmentId ? `(${v.departmentId})` : ""}
            </Badge>
          </a>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>State graph · v{selected.version}</CardTitle>
          <CardDescription>
            Compound states list their branch states; dashed edges are system transitions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StateGraph definition={selected.definition} />
        </CardContent>
      </Card>
      {prevRaw ? (
        <Card>
          <CardHeader>
            <CardTitle>Changes since v{previous!.version}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <p className="font-medium">States</p>
              <ul className="font-mono text-xs">
                {diffKeys(prevRaw.statesJson, selRaw.statesJson).map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium">Transitions</p>
              <ul className="font-mono text-xs">
                {diffKeys(prevRaw.transitionsJson, selRaw.transitionsJson).map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Transitions</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1 font-mono text-xs md:grid-cols-2">
            {selected.definition.transitions.map((t) => (
              <li key={t.key}>
                {t.from} → {t.to}{" "}
                <span className="text-muted-foreground">
                  ({t.action}
                  {t.requiredPermission ? ` · ${t.requiredPermission}` : ""}
                  {t.guards.length ? ` · guards ${t.guards.join(",")}` : ""})
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
