import { adminPageContext } from "@/lib/auth/page";
import { listDefinitions } from "@/platform/workflow/registry";
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

export default async function WorkflowsPage() {
  await adminPageContext();
  const rows = await listDefinitions();
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) (byKey.get(r.key) ?? byKey.set(r.key, []).get(r.key)!).push(r);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow definitions</CardTitle>
        <CardDescription>
          Read-only. Lifecycles are compiled from feature definitions (key{" "}
          <code>feature:&lt;key&gt;</code>); edit them in the feature builder.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {byKey.size === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="workflows-empty">
            No workflow definitions yet: they appear as soon as a feature is published.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Versions</TableHead>
                <TableHead>Instances</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from(byKey.entries()).map(([key, versions]) => (
                <TableRow key={key} data-testid={`workflow-${key}`}>
                  <TableCell>
                    <a
                      className="font-mono underline"
                      href={`/admin/workflows/${encodeURIComponent(key)}`}
                    >
                      {key}
                    </a>
                  </TableCell>
                  <TableCell>{versions[0]!.subjectType}</TableCell>
                  <TableCell>
                    {Array.from(new Set(versions.map((v) => v.departmentId ?? "faculty"))).join(
                      ", ",
                    )}
                  </TableCell>
                  <TableCell className="flex gap-1">
                    {versions.map((v) => (
                      <Badge key={v.id} variant={v.status === "active" ? "default" : "secondary"}>
                        v{v.version} {v.status}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>{versions.reduce((n, v) => n + v._count.instances, 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
