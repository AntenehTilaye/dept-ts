import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

// Read-only rendering of a record's header fields (the form engine of P8 renders inputs).
// One definition list so every record page shows its data the same way.

export interface FieldValue {
  key: string;
  label: string;
  value: ReactNode;
  /** Renders as a badge instead of text. */
  badge?: boolean;
  /** Full-width row (long text). */
  wide?: boolean;
}

export function FieldRenderer({ fields }: { fields: FieldValue[] }) {
  const visible = fields.filter((f) => f.value !== null && f.value !== undefined && f.value !== "");
  if (!visible.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="field-renderer">
      {visible.map((f) => (
        <div key={f.key} className={f.wide ? "sm:col-span-2" : undefined}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {f.label}
          </dt>
          <dd className="mt-0.5 text-sm">
            {f.badge ? <Badge variant="secondary">{f.value}</Badge> : f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
