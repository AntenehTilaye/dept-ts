import { cn } from "@/lib/utils";

/** Server-rendered segmented control whose options are links (filters that live in the URL). */
export function SegmentedLinks({
  label,
  items,
  className,
}: {
  label: string;
  items: { label: string; href: string; active: boolean; count?: number }[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("inline-flex rounded-lg bg-muted p-[3px]", className)}>
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          aria-current={it.active ? "page" : undefined}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
            it.active
              ? "bg-background font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {it.label}
          {it.count !== undefined ? (
            <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] tabular-nums">
              {it.count}
            </span>
          ) : null}
        </a>
      ))}
    </nav>
  );
}
