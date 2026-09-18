import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** Label + input pair used by every registry form. */
export function Field({
  name,
  label,
  type = "text",
  required,
  defaultValue,
  placeholder,
  step,
  min,
  max,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  placeholder?: string;
  step?: string;
  min?: number;
  max?: number;
}) {
  // useId keeps ids unique when the same field name appears in several forms on one page
  const id = `${useId()}-${name}`;
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        step={step}
        min={min}
        max={max}
      />
    </div>
  );
}

export function SelectField({
  name,
  label,
  required,
  defaultValue,
  children,
  emptyLabel,
}: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  children: ReactNode;
  emptyLabel?: string;
}) {
  const id = `${useId()}-${name}`;
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} name={name} required={required} defaultValue={defaultValue ?? ""}>
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {children}
      </Select>
    </div>
  );
}

export function fmtDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function fmtDateTime(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") : "";
}
