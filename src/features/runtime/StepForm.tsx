"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { toast } from "sonner";
import type { FieldDef, Option } from "@/platform/forms/field-schema";
import { FormRenderer, type Answers } from "@/components/forms/FormRenderer";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  actOnStepAction,
  saveStepDraftAction,
} from "@/app/(app)/d/[dept]/f/[featureKey]/actions";

export interface StepAction {
  key: string;
  label: string;
  kind: string;
  requiresComment: boolean;
  allowed: boolean;
  reason?: string;
  confirm?: { title: string; message: string };
}

/**
 * One step of one record: the questions the definition asks, and the actions it offers. A draft
 * is saved without moving the record, so a long form survives an interruption.
 */
export function StepForm({
  dept,
  featureKey,
  recordId,
  stepKey,
  branchKey,
  fields,
  boundOptions,
  initialAnswers,
  actions,
  readOnly,
}: {
  dept: string;
  featureKey: string;
  recordId: string;
  stepKey: string;
  branchKey?: string;
  fields: FieldDef[];
  boundOptions: Record<string, Option[]>;
  initialAnswers: Answers;
  actions: StepAction[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [comment, setComment] = useState("");
  const [issues, setIssues] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsComment = actions.some((a) => a.requiresComment);

  const run = (action: StepAction) => {
    if (action.confirm && !window.confirm(`${action.confirm.title}\n\n${action.confirm.message}`))
      return;
    setIssues({});
    setMessage(null);
    startTransition(async () => {
      const result = await actOnStepAction({
        dept,
        featureKey,
        recordId,
        stepKey,
        actionKey: action.key,
        branchKey,
        comment: comment.trim() || undefined,
        answers,
      });
      if (result.ok) {
        toast.success(`${action.label} done.`);
        router.push(`/d/${dept}/f/${featureKey}/${recordId}` as Route);
        router.refresh();
        return;
      }
      if (result.issues) setIssues(result.issues);
      setMessage(result.message);
    });
  };

  const saveDraft = () => {
    startTransition(async () => {
      const result = await saveStepDraftAction({
        dept,
        featureKey,
        recordId,
        stepKey,
        branchKey,
        answers,
      });
      if (result.ok) toast.success("Draft saved.");
      else setMessage(result.message);
    });
  };

  return (
    <div className="grid gap-4">
      {message ? (
        <Alert variant="destructive" role="alert">
          <span>{message}</span>
        </Alert>
      ) : null}

      {fields.length ? (
        <FormRenderer
          fields={fields}
          boundOptions={boundOptions}
          answers={answers}
          onChange={readOnly ? () => {} : setAnswers}
          issues={issues}
          disabled={readOnly}
        />
      ) : (
        <p className="text-sm text-muted-foreground">This step asks no questions.</p>
      )}

      {needsComment && !readOnly ? (
        <div className="grid gap-1.5">
          <Label htmlFor="step-comment">Comment</Label>
          <Textarea
            id="step-comment"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Why, in one or two sentences"
          />
        </div>
      ) : null}

      {!readOnly ? (
        <div className="flex flex-wrap justify-end gap-2">
          {fields.length ? (
            <Button type="button" variant="outline" onClick={saveDraft} disabled={pending}>
              Save draft
            </Button>
          ) : null}
          {actions.map((action) => (
            <Button
              key={action.key}
              type="button"
              variant={action.kind === "reject" ? "destructive" : "default"}
              onClick={() => run(action)}
              disabled={pending || !action.allowed}
              title={action.reason}
              aria-busy={pending}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
