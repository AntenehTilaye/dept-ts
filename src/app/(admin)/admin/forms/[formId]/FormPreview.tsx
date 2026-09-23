"use client";

import { useState } from "react";
import type { FieldDef } from "@/platform/forms/field-schema";
import { FormRenderer, type Answers } from "@/components/forms/FormRenderer";

/** Renders the form with throw-away state so an administrator can try the questions. */
export function FormPreview({ fields }: { fields: FieldDef[] }) {
  const [answers, setAnswers] = useState<Answers>({});
  return (
    <div data-testid="form-preview">
      <FormRenderer fields={fields} answers={answers} onChange={setAnswers} />
    </div>
  );
}
