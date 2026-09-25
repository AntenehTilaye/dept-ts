"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions/safe-action";
import type { AvailableAction } from "@/platform/workflow/engine";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type TransitionAction = (input: {
  transitionKey: string;
  branchKey?: string;
  comment?: string;
  fields?: Record<string, string>;
}) => Promise<ActionResult<unknown>>;

/**
 * Buttons for the actions a workflow instance offers the current actor. Disabled actions show
 * their reason; actions that need a comment or fields open an inline sheet before confirming.
 */
export function ActionBar({
  actions,
  onAct,
}: {
  actions: AvailableAction[];
  onAct: TransitionAction;
}) {
  const [open, setOpen] = useState<AvailableAction | null>(null);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();

  function run(a: AvailableAction, form?: FormData) {
    const fields: Record<string, string> = {};
    for (const f of a.requiredFields) fields[f] = String(form?.get(`field:${f}`) ?? "");
    start(async () => {
      const r = await onAct({
        transitionKey: a.transitionKey,
        branchKey: a.branchKey,
        comment: form ? String(form.get("comment") ?? "") : undefined,
        fields,
      });
      setResult(r);
      if (r.ok) setOpen(null);
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="action-bar">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={`${a.transitionKey}:${a.branchKey ?? ""}`}
            variant={a.enabled ? "default" : "outline"}
            size="sm"
            disabled={!a.enabled || pending}
            title={a.disabledReason}
            onClick={() => (a.requiredComment || a.requiredFields.length ? setOpen(a) : run(a))}
          >
            {a.label ?? a.action}
            {a.branchKey ? ` (${a.branchKey})` : ""}
          </Button>
        ))}
        {actions.length === 0 ? (
          <span className="text-sm text-muted-foreground">No actions available.</span>
        ) : null}
      </div>
      {open ? (
        <form
          className="grid max-w-md gap-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(open, new FormData(e.currentTarget));
          }}
        >
          <p className="text-sm font-medium">Confirm: {open.label ?? open.action}</p>
          {open.requiredFields.map((f) => (
            <div key={f} className="grid gap-1">
              <Label htmlFor={`field-${f}`}>{f}</Label>
              <Input id={`field-${f}`} name={`field:${f}`} required />
            </div>
          ))}
          {open.requiredComment ? (
            <div className="grid gap-1">
              <Label htmlFor="comment">Comment</Label>
              <textarea
                id="comment"
                name="comment"
                required
                className="min-h-20 rounded-md border px-3 py-2 text-sm"
              />
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Working…" : "Confirm"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {result && !result.ok ? <Alert variant="destructive">{result.message}</Alert> : null}
    </div>
  );
}
