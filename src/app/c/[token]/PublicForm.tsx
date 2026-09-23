"use client";

import { useState, useTransition } from "react";
import { CheckCircle2Icon, SendIcon } from "lucide-react";
import type { FieldDef } from "@/platform/forms/field-schema";
import { FormRenderer, type Answers } from "@/components/forms/FormRenderer";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { submitCampaignAction } from "./actions";

/** The public campaign form: no session, one token, one submission. */
export function PublicForm({
  token,
  fields,
  initialAnswers,
  anonymous,
  editing,
}: {
  token: string;
  fields: FieldDef[];
  initialAnswers: Answers;
  anonymous: boolean;
  editing: boolean;
}) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [issues, setIssues] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (done)
    return (
      <Alert variant="success" data-testid="submitted">
        <CheckCircle2Icon />
        <span>
          Thank you — your response has been recorded
          {anonymous ? " anonymously" : ""}. You may close this page.
        </span>
      </Alert>
    );

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await submitCampaignAction({ token, answers });
          if (result.ok) {
            setDone(true);
            return;
          }
          setIssues(result.issues ?? {});
          setError(result.issues ? null : result.message);
        });
      }}
    >
      {error ? (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      ) : null}
      <FormRenderer
        fields={fields}
        answers={answers}
        onChange={setAnswers}
        issues={issues}
        disabled={pending}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {anonymous
            ? "Your response is stored without any link to you or to this invitation."
            : "Your response is recorded under your name."}
        </p>
        <Button type="submit" disabled={pending}>
          <SendIcon /> {pending ? "Sending…" : editing ? "Update my response" : "Submit"}
        </Button>
      </div>
    </form>
  );
}
