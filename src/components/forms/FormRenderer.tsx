"use client";

import { useId, useMemo, useState } from "react";
import { GripVerticalIcon, PlusIcon, XIcon } from "lucide-react";
import type { FieldDef, Option } from "@/platform/forms/field-schema";
import { isVisible } from "@/platform/forms/zod-from-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Renders a form from its fields, controlled by a single answers object. Validation is the
// server's job (the same zodFromFields schema); this component only shows the issues it is
// given and keeps conditional fields in sync.

export type Answers = Record<string, unknown>;

export interface FormRendererProps {
  fields: FieldDef[];
  answers: Answers;
  onChange: (answers: Answers) => void;
  issues?: Record<string, string[]>;
  disabled?: boolean;
  /** Options resolved for source-bound questions, keyed by field key. */
  boundOptions?: Record<string, Option[]>;
}

function optionsOf(field: FieldDef, bound?: Record<string, Option[]>): Option[] {
  return bound?.[field.key] ?? field.options ?? [];
}

export function FormRenderer({
  fields,
  answers,
  onChange,
  issues,
  disabled,
  boundOptions,
}: FormRendererProps) {
  const visible = useMemo(() => fields.filter((f) => isVisible(f, answers)), [fields, answers]);
  const set = (key: string, value: unknown) => onChange({ ...answers, [key]: value });

  return (
    <div className="flex flex-col gap-5" data-testid="form-renderer">
      {visible.map((field) => (
        <FieldControl
          key={field.key}
          field={field}
          value={answers[field.key]}
          onChange={(v) => set(field.key, v)}
          issues={issues?.[field.key]}
          disabled={disabled}
          options={optionsOf(field, boundOptions)}
          boundOptions={boundOptions}
        />
      ))}
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  issues,
  disabled,
  options,
  boundOptions,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  issues?: string[];
  disabled?: boolean;
  options: Option[];
  boundOptions?: Record<string, Option[]>;
}) {
  const id = `${useId()}-${field.key}`;
  const required = field.constraints?.required ?? false;
  const describedBy = [field.helpText ? `${id}-hint` : null, issues?.length ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  if (field.type === "section_header") {
    return (
      <div className="border-b pb-1" data-testid={`question-${field.key}`}>
        <h3 className="text-sm font-semibold">{field.label}</h3>
        {field.helpText ? <p className="text-xs text-muted-foreground">{field.helpText}</p> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-1.5" data-testid={`question-${field.key}`}>
      <Label
        htmlFor={id}
        className={required ? "after:ml-0.5 after:text-destructive after:content-['*']" : undefined}
      >
        {field.label}
      </Label>
      {field.helpText ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {field.helpText}
        </p>
      ) : null}
      <Control
        id={id}
        field={field}
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={options}
        describedBy={describedBy || undefined}
        invalid={!!issues?.length}
        boundOptions={boundOptions}
      />
      {issues?.length ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {issues.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

interface ControlProps {
  id: string;
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  options: Option[];
  describedBy?: string;
  invalid?: boolean;
  boundOptions?: Record<string, Option[]>;
}

function Control(props: ControlProps) {
  const { id, field, value, onChange, disabled, options, describedBy, invalid } = props;
  const common = {
    id,
    disabled,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
  };

  switch (field.type) {
    case "long_text":
      return (
        <Textarea
          {...common}
          rows={4}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <Input
          {...common}
          type="number"
          min={field.constraints?.min}
          max={field.constraints?.max}
          value={(value as number | string) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "date":
    case "datetime":
      return (
        <Input
          {...common}
          type={field.type === "date" ? "date" : "datetime-local"}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            id={id}
            disabled={disabled}
            checked={value === true}
            onCheckedChange={(v) => onChange(v === true)}
          />
          Yes
        </label>
      );
    case "likert":
    case "scale": {
      const min = field.constraints?.min ?? 1;
      const max = field.constraints?.max ?? 5;
      const points = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      return (
        <div
          role="radiogroup"
          aria-labelledby={id}
          aria-describedby={describedBy}
          className="flex flex-wrap gap-2"
        >
          {points.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={Number(value) === p}
              disabled={disabled}
              onClick={() => onChange(p)}
              className={cn(
                "size-10 rounded-md border text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                Number(value) === p
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      );
    }
    case "single_choice":
    case "person_picker":
    case "group_picker":
    case "course_picker":
    case "offering_picker":
    case "section_picker":
    case "term_picker":
    case "resource_picker":
    case "task_picker":
    case "record_picker":
      return (
        <NativeSelect
          {...common}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">(choose)</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      );
    case "multi_choice": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-1.5" aria-describedby={describedBy}>
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                disabled={disabled}
                checked={selected.includes(o.value)}
                onCheckedChange={(v) =>
                  onChange(
                    v === true ? [...selected, o.value] : selected.filter((s) => s !== o.value),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "ranked_list":
      return <RankedList {...props} />;
    case "repeating_group":
      return <RepeatingGroup {...props} />;
    case "file":
      return (
        <p className="text-xs text-muted-foreground">
          Files are attached from the record page once the response is saved.
        </p>
      );
    case "computed":
      return <p className="text-sm">{String(value ?? "—")}</p>;
    default:
      return (
        <Input
          {...common}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Order-by-selection list: click to rank, click again to unrank. */
function RankedList({ field, value, onChange, disabled, options }: ControlProps) {
  const order = ((value as { order?: string[] } | null)?.order ?? []).filter(Boolean);
  const toggle = (id: string) => {
    const next = order.includes(id) ? order.filter((o) => o !== id) : [...order, id];
    onChange({ order: next });
  };
  const move = (id: string, delta: number) => {
    const index = order.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ order: next });
  };
  return (
    <ul className="flex flex-col gap-1" data-testid={`ranked-${field.key}`}>
      {options.map((o) => {
        const rank = order.indexOf(o.value);
        const ranked = rank >= 0;
        return (
          <li
            key={o.value}
            data-rank={ranked ? rank + 1 : undefined}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
              ranked && "border-primary/50 bg-primary/5",
            )}
          >
            <span className="flex items-center gap-2">
              <GripVerticalIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              {ranked ? <span className="font-medium tabular-nums">{rank + 1}.</span> : null}
              {o.label}
            </span>
            <span className="flex gap-1">
              {ranked ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || rank === 0}
                    onClick={() => move(o.value, -1)}
                    aria-label={`Move ${o.label} up`}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || rank === order.length - 1}
                    onClick={() => move(o.value, 1)}
                    aria-label={`Move ${o.label} down`}
                  >
                    ↓
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant={ranked ? "ghost" : "outline"}
                size="sm"
                disabled={disabled}
                onClick={() => toggle(o.value)}
                aria-label={ranked ? `Unrank ${o.label}` : `Rank ${o.label}`}
              >
                {ranked ? <XIcon /> : "Rank"}
              </Button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Repeating group: a list of sub-answer rows. */
function RepeatingGroup({ field, value, onChange, disabled, boundOptions }: ControlProps) {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const [nonce, setNonce] = useState(0);
  const max = field.constraints?.maxItems;
  const update = (index: number, key: string, v: unknown) => {
    const next = rows.map((r, i) => (i === index ? { ...r, [key]: v } : r));
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-3" data-testid={`group-${field.key}`}>
      {rows.map((row, index) => (
        <div key={`${nonce}-${index}`} className="rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">#{index + 1}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                onChange(rows.filter((_, i) => i !== index));
                setNonce((n) => n + 1);
              }}
              aria-label={`Remove entry ${index + 1}`}
            >
              <XIcon />
            </Button>
          </div>
          <FormRenderer
            fields={field.fields ?? []}
            answers={row}
            onChange={(next) => {
              for (const [k, v] of Object.entries(next)) update(index, k, v);
            }}
            disabled={disabled}
            boundOptions={boundOptions}
          />
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || (max !== undefined && rows.length >= max)}
          onClick={() => onChange([...rows, {}])}
        >
          <PlusIcon /> Add entry
        </Button>
      </div>
    </div>
  );
}
