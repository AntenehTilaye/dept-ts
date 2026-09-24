"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { toast } from "sonner";
import type { FieldDef, Option } from "@/platform/forms/field-schema";
import { FormRenderer, type Answers } from "@/components/forms/FormRenderer";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createRecordAction } from "@/app/(app)/d/[dept]/f/[featureKey]/actions";

/**
 * The create form of any feature: the questions are the definition's own record fields, so this
 * component never knows which feature it is rendering.
 */
export function NewRecordForm({
  dept,
  featureKey,
  fields,
  boundOptions,
  presets,
  initialPreset,
  parentRef,
  submitLabel,
}: {
  dept: string;
  featureKey: string;
  fields: FieldDef[];
  boundOptions: Record<string, Option[]>;
  presets: { key: string; label: string }[];
  initialPreset?: string;
  parentRef?: { subjectType: string; subjectId: string };
  submitLabel: string;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>({});
  const [preset, setPreset] = useState(initialPreset ?? presets[0]?.key ?? "");
  const [issues, setIssues] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setIssues({});
    setMessage(null);
    startTransition(async () => {
      const result = await createRecordAction({
        dept,
        featureKey,
        presetKey: preset || undefined,
        data: answers,
        parentRef,
      });
      if (result.ok) {
        toast.success("Created.");
        router.push(`/d/${dept}/f/${featureKey}/${result.data.id}` as Route);
        return;
      }
      if (result.issues) setIssues(result.issues);
      setMessage(result.message);
    });
  };

  return (
    <div className="grid gap-4">
      {message ? (
        <Alert variant="destructive" role="alert">
          <span>{message}</span>
        </Alert>
      ) : null}

      {presets.length > 1 ? (
        <div className="grid gap-1.5">
          <Label htmlFor="preset">Kind</Label>
          <NativeSelect id="preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {presets.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      <FormRenderer
        fields={fields}
        answers={answers}
        onChange={setAnswers}
        issues={issues}
        boundOptions={boundOptions}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={pending} aria-busy={pending}>
          {pending ? "Working…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
