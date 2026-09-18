"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/actions/safe-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type FormAction = (formData: FormData) => Promise<ActionResult<unknown>>;

/**
 * A form bound to a form-data server action, showing the ActionResult inline. Works without
 * client JavaScript too (the action still runs; only the message is lost).
 */
export function ActionForm({
  action,
  submitLabel,
  successMessage = "Saved.",
  className,
  children,
  resetOnSuccess = true,
}: {
  action: FormAction;
  submitLabel: string;
  successMessage?: string;
  className?: string;
  children: ReactNode;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    async (_prev: ActionResult<unknown> | null, formData: FormData) => action(formData),
    null,
  );
  const issues = state && !state.ok && state.issues ? Object.entries(state.issues) : [];
  return (
    <form
      action={formAction}
      className={className}
      key={resetOnSuccess && state?.ok ? "reset" : "form"}
    >
      {state?.ok ? <Alert variant="success">{successMessage}</Alert> : null}
      {state && !state.ok ? (
        <Alert variant="destructive">
          <span>{state.message}</span>
          {issues.length ? (
            <ul className="list-disc pl-4">
              {issues.map(([field, messages]) => (
                <li key={field}>
                  {field}: {messages.join(", ")}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {children}
      <Button type="submit" disabled={pending}>
        {pending ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}
