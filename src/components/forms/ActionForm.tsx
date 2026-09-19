"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions/safe-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type FormAction = (formData: FormData) => Promise<ActionResult<unknown>>;
type ButtonProps = React.ComponentProps<typeof Button>;

/**
 * A form bound to a form-data server action. Success and failure surface as toasts, field
 * issues additionally as an inline alert next to the fields. Works without client JavaScript
 * too (the action still runs; only the feedback is lost).
 */
export function ActionForm({
  action,
  submitLabel,
  successMessage = "Saved.",
  className,
  children,
  resetOnSuccess = true,
  variant = "default",
  size = "default",
}: {
  action: FormAction;
  submitLabel: string;
  successMessage?: string;
  className?: string;
  children: ReactNode;
  resetOnSuccess?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const [state, formAction, pending] = useActionState(
    async (_prev: ActionResult<unknown> | null, formData: FormData) => action(formData),
    null,
  );
  const issues = state && !state.ok && state.issues ? Object.entries(state.issues) : [];
  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(successMessage);
    else if (!state.issues) toast.error(state.message);
  }, [state, successMessage]);
  return (
    <form
      action={formAction}
      className={className}
      key={resetOnSuccess && state?.ok ? "reset" : "form"}
    >
      {state?.ok ? (
        <span role="alert" className="sr-only">
          {successMessage}
        </span>
      ) : null}
      {state && !state.ok && issues.length ? (
        <Alert variant="destructive">
          <span>{state.message}</span>
          <ul className="list-disc pl-4">
            {issues.map(([field, messages]) => (
              <li key={field}>
                {field}: {messages.join(", ")}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {children}
      <Button type="submit" disabled={pending} variant={variant} size={size} aria-busy={pending}>
        {pending ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}
