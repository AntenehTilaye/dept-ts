import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";
import type { Issue } from "@/platform/feature/validate";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * What is wrong with a definition, in the words of the rule that found it. Errors block a
 * publish; warnings are the things that will merely disappoint someone later — a review with no
 * deadline, a step nobody is told about.
 */
export function IssuesPanel({ issues }: { issues: Issue[] }) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {errors.length ? (
            <AlertTriangleIcon className="size-4 text-destructive" aria-hidden="true" />
          ) : (
            <CheckCircle2Icon className="size-4 text-emerald-600" aria-hidden="true" />
          )}
          Validation
        </CardTitle>
        <CardDescription>
          {errors.length
            ? `${errors.length} thing${errors.length === 1 ? "" : "s"} to fix before this can be published.`
            : "Nothing blocks publishing."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No issues.</p>
        ) : (
          <ul className="divide-y text-sm" data-testid="issues">
            {[...errors, ...warnings].map((issue, i) => (
              <li key={`${issue.code}-${i}`} className="flex items-start gap-3 py-2">
                {issue.severity === "error" ? (
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                ) : (
                  <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <p>{issue.message}</p>
                  <p className="text-xs text-muted-foreground">
                    <Badge variant="outline" className="mr-2">
                      {issue.code}
                    </Badge>
                    <span className="font-mono">{issue.path}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
