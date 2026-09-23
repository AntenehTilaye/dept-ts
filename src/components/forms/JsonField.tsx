"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Label + JSON textarea with a live "does this parse" badge.
 *
 * The textarea stays uncontrolled on purpose: the form is server-rendered and usable before
 * React takes over, and anything typed in that window has to survive hydration rather than be
 * replaced by the markup the server sent. The component therefore adopts the element's own
 * value on mount and only tracks changes from there, and marks itself `data-hydrated` so an
 * end-to-end test can wait for the editor to be interactive before it types.
 */
export function JsonField({
  name,
  label,
  initialValue,
  rows = 12,
  hint,
  required,
}: {
  name: string;
  label: string;
  initialValue: string;
  rows?: number;
  hint?: string;
  required?: boolean;
}) {
  const id = `${useId()}-${name}`;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => setValue(ref.current?.value ?? initialValue), [initialValue]);
  const problem = parseProblem(value ?? initialValue);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span
          className={problem ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
          role={problem ? "status" : undefined}
        >
          {problem ?? "valid JSON"}
        </span>
      </div>
      <Textarea
        id={id}
        ref={ref}
        name={name}
        rows={rows}
        required={required}
        defaultValue={initialValue}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        data-hydrated={value === null ? undefined : "true"}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-invalid={problem ? true : undefined}
        className="font-mono text-xs"
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function parseProblem(value: string): string | null {
  try {
    JSON.parse(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 80) : "not valid JSON";
  }
}
