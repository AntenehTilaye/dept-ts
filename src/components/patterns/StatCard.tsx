import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Headline number tile (progressive disclosure: numbers first, details behind the link). */
export function StatCard({
  label,
  value,
  hint,
  href,
  tone = "default",
  icon,
  ...props
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: "default" | "warning" | "danger" | "success";
  icon?: ReactNode;
} & React.ComponentProps<"div">) {
  const tones = {
    default: "",
    warning: "border-amber-500/40",
    danger: "border-destructive/50",
    success: "border-emerald-500/40",
  };
  const body = (
    <CardContent className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {icon ? <span className="text-muted-foreground [&>svg]:size-5">{icon}</span> : null}
    </CardContent>
  );
  return (
    <Card
      className={cn("py-0 transition-colors", tones[tone], href && "hover:bg-accent/40")}
      {...props}
    >
      {href ? (
        <a
          href={href}
          className="block rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {body}
        </a>
      ) : (
        body
      )}
    </Card>
  );
}
