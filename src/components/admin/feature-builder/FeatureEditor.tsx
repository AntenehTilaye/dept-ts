"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LockIcon } from "lucide-react";
import { toast } from "sonner";
import type { Issue } from "@/platform/feature/validate";
import { JsonField } from "@/components/forms/JsonField";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { saveDraftAction, validateDraftAction } from "@/app/(admin)/admin/features/actions";

/**
 * The definition itself, edited as the document it is. Validation runs against the database, so
 * an administrator sees the same issues publishing would raise — and a locked pointer is refused
 * here, with the pointer named, rather than silently reverted later.
 */
export function FeatureEditor({
  definitionId,
  featureKey,
  json,
  locks,
  isSystem,
}: {
  definitionId: string;
  featureKey: string;
  json: string;
  locks: string[];
  isSystem: boolean;
}) {
  const router = useRouter();
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const read = (): string => {
    const field = document.querySelector<HTMLTextAreaElement>('textarea[name="json"]');
    return field?.value ?? json;
  };

  const validate = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await validateDraftAction({ definitionId, json: read() });
      if (!result.ok) {
        setIssues(null);
        setMessage(result.message);
        return;
      }
      setIssues(result.data.issues);
      toast.success(
        result.data.issues.some((i) => i.severity === "error")
          ? "There are still errors."
          : "This definition is publishable.",
      );
    });
  };

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveDraftAction({ definitionId, json: read() });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      toast.success(`Draft v${result.data.version} saved.`);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Definition</CardTitle>
        <CardDescription>
          The whole feature as one document: navigation, scope, record fields, steps, terminals,
          list views and counters. Save leaves a draft; publishing is the separate button above.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {isSystem ? (
          <Alert>
            <span className="flex flex-wrap items-center gap-2">
              <LockIcon className="size-4" aria-hidden="true" />
              <span>
                <strong>{featureKey}</strong> is backed by code. {locks.length} pointer
                {locks.length === 1 ? "" : "s"} — the backing, adapters, guards, effects and
                automatic triggers — cannot be changed here.
              </span>
            </span>
          </Alert>
        ) : null}

        {message ? (
          <Alert variant="destructive" role="alert">
            <span>{message}</span>
          </Alert>
        ) : null}

        <JsonField name="json" label="Definition (JSON)" rows={24} required initialValue={json} />

        {issues ? (
          <ul className="grid gap-1 text-sm" data-testid="editor-issues">
            {issues.length === 0 ? <li className="text-muted-foreground">No issues.</li> : null}
            {issues.map((issue, i) => (
              <li key={`${issue.code}-${i}`} className="flex items-start gap-2">
                <Badge variant={issue.severity === "error" ? "destructive" : "outline"}>
                  {issue.code}
                </Badge>
                <span>
                  {issue.message} <span className="font-mono text-xs">{issue.path}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={validate} disabled={pending}>
            Validate
          </Button>
          <Button type="button" onClick={save} disabled={pending} aria-busy={pending}>
            {pending ? "Working…" : "Save draft"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
