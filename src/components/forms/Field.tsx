import { useId, type ComponentProps, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

// The asterisk is a CSS pseudo-element so that the label text (what tests and screen readers
// match on) stays exactly the label.
const REQUIRED = "after:ml-0.5 after:text-destructive after:content-['*']";

/**
 * Label + input pair used by every registry form. `hint` is microcopy under the field
 * (format, example, consequence) linked through aria-describedby; `required` marks the
 * label so the form never relies on colour alone.
 */
export function Field({
  name,
  label,
  hint,
  type = "text",
  required,
  className,
  ...input
}: {
  name: string;
  label: string;
  hint?: ReactNode;
  type?: string;
  required?: boolean;
} & Omit<ComponentProps<typeof Input>, "name" | "type" | "required" | "id">) {
  // useId keeps ids unique when the same field name appears in several forms on one page
  const id = `${useId()}-${name}`;
  return (
    <div className={className ?? "grid gap-1.5"}>
      <Label htmlFor={id} className={required ? REQUIRED : undefined}>
        {label}
      </Label>
      <Input
        id={id}
        name={name}
        type={type}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...input}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  name,
  label,
  hint,
  required,
  defaultValue,
  children,
  emptyLabel,
}: {
  name: string;
  label: string;
  hint?: ReactNode;
  required?: boolean;
  defaultValue?: string;
  children: ReactNode;
  emptyLabel?: string;
}) {
  const id = `${useId()}-${name}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className={required ? REQUIRED : undefined}>
        {label}
      </Label>
      <NativeSelect
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue ?? ""}
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {children}
      </NativeSelect>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function fmtDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function fmtDateTime(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") : "";
}
