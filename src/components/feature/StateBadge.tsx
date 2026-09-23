import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// One state vocabulary for every record page: the workflow state with the visual weight of its
// category (waiting states are muted, terminals outlined, rejections destructive).

export type StateCategory = "initial" | "active" | "waiting" | "terminal";

const VARIANT: Record<StateCategory, React.ComponentProps<typeof Badge>["variant"]> = {
  initial: "secondary",
  active: "default",
  waiting: "secondary",
  terminal: "outline",
};

export function StateBadge({
  state,
  label,
  category = "active",
  terminalCategory,
  className,
}: {
  state: string;
  label?: string;
  category?: StateCategory;
  terminalCategory?: "success" | "rejected" | "cancelled";
  className?: string;
}) {
  const variant = terminalCategory === "rejected" ? "destructive" : VARIANT[category];
  return (
    <Badge
      variant={variant}
      data-testid="state-badge"
      data-state={state}
      className={cn(
        terminalCategory === "success" &&
          "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
        className,
      )}
    >
      {label ?? state}
    </Badge>
  );
}
