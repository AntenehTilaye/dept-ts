"use client";

import { useState, useTransition } from "react";
import { PlayIcon } from "lucide-react";
import type { SimulationTrace } from "@/platform/feature/simulate";
import { JsonField } from "@/components/forms/JsonField";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { simulateDraftAction } from "@/app/(admin)/admin/features/actions";

const SAMPLE = `{
  "actor": {
    "personId": "sim-actor",
    "roles": ["instructor", "department_head"],
    "grantRoleKeys": [],
    "relationships": ["owner", "creator", "assignee"]
  },
  "record": {},
  "path": []
}`;

/**
 * A dry run: which states the record would pass through, who would be assigned, which tasks and
 * notifications would appear and which grants the actor would still need. Nothing is written.
 */
export function SimulatePanel({
  definitionJson,
  featureKey,
}: {
  definitionJson: string;
  featureKey: string;
}) {
  const [trace, setTrace] = useState<SimulationTrace | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setMessage(null);
    const script =
      document.querySelector<HTMLTextAreaElement>('textarea[name="script"]')?.value ?? SAMPLE;
    startTransition(async () => {
      const result = await simulateDraftAction({ json: definitionJson, script });
      if (!result.ok) {
        setTrace(null);
        setMessage(result.message);
        return;
      }
      setTrace(result.data.trace);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Simulate</CardTitle>
        <CardDescription>
          Play a path through <span className="font-mono">{featureKey}</span> without touching the
          database. An adapter is reported as “would run” rather than guessed at.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {message ? (
          <Alert variant="destructive" role="alert">
            <span>{message}</span>
          </Alert>
        ) : null}

        <JsonField name="script" label="Script (JSON)" rows={10} initialValue={SAMPLE} />

        <div className="flex justify-end">
          <Button type="button" onClick={run} disabled={pending} aria-busy={pending}>
            <PlayIcon aria-hidden="true" /> {pending ? "Running…" : "Run simulation"}
          </Button>
        </div>

        {trace ? (
          <div className="grid gap-3 text-sm" data-testid="simulation-trace">
            <p>
              <span className="text-muted-foreground">States</span>{" "}
              {trace.states.map((state, i) => (
                <Badge key={`${state}-${i}`} variant="secondary" className="mr-1">
                  {state}
                </Badge>
              ))}
            </p>
            <div>
              <p className="text-muted-foreground">Steps entered</p>
              <ul className="ml-4 list-disc">
                {trace.steps.map((step, i) => (
                  <li key={`${step.stepKey}-${i}`}>
                    {step.stepKey}
                    {step.branchKey ? ` (${step.branchKey})` : ""} — assignee {step.assignee}
                    {step.task?.createTask ? ", creates a task" : ""}
                    {step.deadline ? `, due ${step.deadline.slice(0, 10)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
            {trace.notifications.length ? (
              <div>
                <p className="text-muted-foreground">Notifications</p>
                <ul className="ml-4 list-disc">
                  {trace.notifications.map((n, i) => (
                    <li key={`${n.templateKey}-${i}`}>
                      {n.templateKey} → {n.to}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {trace.grantsNeeded.length ? (
              <p>
                <span className="text-muted-foreground">Grants needed</span>{" "}
                {trace.grantsNeeded.join(", ")}
              </p>
            ) : null}
            {trace.guards.length ? (
              <p className="text-xs text-muted-foreground">
                Guards: {trace.guards.map((g) => `${g.key} (${g.result})`).join(", ")}
              </p>
            ) : null}
            {trace.issues.some((i) => i.severity === "error") ? (
              <Alert variant="destructive">
                <span>
                  {trace.issues
                    .filter((i) => i.severity === "error")
                    .map((i) => i.message)
                    .join(" · ")}
                </span>
              </Alert>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
