import type { ReactNode } from "react";

/** List on the left, an editor or details panel on the right; stacks on small screens. */
export function ListLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0">{children}</div>
      {aside ? <div className="min-w-0">{aside}</div> : null}
    </div>
  );
}
