import type { ReactNode } from "react";
import { InboxIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * NN/g empty state: (1) system status, (2) what fills this space, (3) a direct pathway.
 * Compact variant fits inside cards and table bodies.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact,
  className,
  ...props
}: {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
} & React.ComponentProps<"div">) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center",
        compact ? "px-4 py-6" : "px-6 py-12",
        className,
      )}
      {...props}
    >
      <span className="text-muted-foreground [&>svg]:size-6" aria-hidden="true">
        {icon ?? <InboxIcon />}
      </span>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-md text-sm text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
