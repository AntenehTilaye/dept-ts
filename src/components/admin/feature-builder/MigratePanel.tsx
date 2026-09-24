"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { MigrationPlan } from "@/platform/feature/migrate";
import { JsonField } from "@/components/forms/JsonField";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { planMigrationAction, startMigrationAction } from "@/app/(admin)/admin/features/actions";

/**
 * Plan, then run. The preview says how many records move, which ones would be blocked and what
 * the new version no longer has; only then does the run button queue the job.
 */
export function MigratePanel({
  definitionId,
  activeVersionId,
  versions,
  departments,
  targetStates,
}: {
  definitionId: string;
  activeVersionId: string;
  versions: { id: string; version: number; status: string }[];
  departments: { id: string; name: string }[];
  targetStates: string[];
}) {
  const router = useRouter();
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [fromVersionId, setFromVersionId] = useState(
    versions.find((v) => v.id !== activeVersionId)?.id ?? versions[0]?.id ?? "",
  );
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const stateMap = () =>
    document.querySelector<HTMLTextAreaElement>('textarea[name="stateMap"]')?.value ?? "{}";

  const preview = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await planMigrationAction({
        definitionId,
        departmentId,
        fromVersionId,
        toVersionId: activeVersionId,
        stateMap: stateMap(),
      });
      if (!result.ok) {
        setPlan(null);
        setMessage(result.message);
        return;
      }
      setPlan(result.data.plan);
    });
  };

  const run = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await startMigrationAction({
        definitionId,
        departmentId,
        fromVersionId,
        toVersionId: activeVersionId,
        stateMap: stateMap(),
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      toast.success(`Queued: ${result.data.total} record(s) to move.`);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan a migration</CardTitle>
        <CardDescription>
          Map every state of the old version onto one of the new version, or onto{" "}
          <span className="font-mono">$block</span> to leave its records where they are.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {message ? (
          <Alert variant="destructive" role="alert">
            <span>{message}</span>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="migrate-department">Department</Label>
            <NativeSelect
              id="migrate-department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="migrate-from">From version</Label>
            <NativeSelect
              id="migrate-from"
              value={fromVersionId}
              onChange={(e) => setFromVersionId(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} ({v.status})
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <JsonField
          name="stateMap"
          label="State map (JSON)"
          rows={6}
          initialValue="{}"
          hint={`States the new version has: ${targetStates.join(", ")}`}
        />

        {plan ? (
          <div className="grid gap-2 text-sm" data-testid="migration-plan">
            <p>
              v{plan.fromVersion} → v{plan.toVersion}: {plan.recordsTotal} record
              {plan.recordsTotal === 1 ? "" : "s"}, {plan.recordsBlocked} blocked.
            </p>
            <p>
              {Object.entries(plan.byState).map(([state, count]) => (
                <Badge key={state} variant="secondary" className="mr-1">
                  {state}: {count}
                </Badge>
              ))}
            </p>
            {plan.removedStates.length ? (
              <p className="text-muted-foreground">
                Gone in the new version: {plan.removedStates.join(", ")}
              </p>
            ) : null}
            {plan.blockedStates.length ? (
              <p className="text-destructive">
                No target for: {plan.blockedStates.join(", ")}
              </p>
            ) : null}
            {plan.warnings.map((warning) => (
              <p key={warning} className="text-muted-foreground">
                {warning}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={preview} disabled={pending}>
            Preview
          </Button>
          <Button type="button" onClick={run} disabled={pending || !plan} aria-busy={pending}>
            {pending ? "Working…" : "Run migration"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
