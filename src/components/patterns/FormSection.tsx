import type { ReactNode } from "react";

/** Groups related fields with a heading and microcopy (NN/g form structure and transparency). */
export function FormSection({
  title,
  description,
  children,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <fieldset className="grid gap-3 rounded-lg border p-4">
      {title ? <legend className="px-1 text-sm font-medium">{title}</legend> : null}
      {description ? <p className="-mt-1 text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </fieldset>
  );
}
