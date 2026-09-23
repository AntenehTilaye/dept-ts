import { CheckIcon, CircleDashedIcon, CircleDotIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// The record's progress through its workflow: the states of the definition in order, with the
// current one highlighted and the transitions already taken marked done. P9's parallel groups
// render their branches inside a lane (ParallelLanes) but reuse these step rows.

export interface TimelineStep {
  key: string;
  label: string;
  status: "done" | "current" | "pending" | "rejected" | "skipped";
  at?: string | null;
  actor?: string | null;
}

const ICON = {
  done: CheckIcon,
  current: CircleDotIcon,
  pending: CircleDashedIcon,
  rejected: XIcon,
  skipped: CircleDashedIcon,
};

export function StepTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="flex flex-col" data-testid="step-timeline">
      {steps.map((s, i) => {
        const Icon = ICON[s.status];
        return (
          <li
            key={s.key}
            className="flex gap-3"
            data-testid={`step-${s.key}`}
            data-status={s.status}
          >
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border",
                  s.status === "done" && "border-emerald-500/60 bg-emerald-500/10 text-emerald-600",
                  s.status === "current" && "border-primary bg-primary/10 text-primary",
                  s.status === "rejected" &&
                    "border-destructive bg-destructive/10 text-destructive",
                  (s.status === "pending" || s.status === "skipped") && "text-muted-foreground",
                )}
                aria-hidden="true"
              >
                <Icon className="size-3.5" />
              </span>
              {i < steps.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
            </div>
            <div className={cn("pb-4", s.status === "pending" && "text-muted-foreground")}>
              <p className="text-sm font-medium">
                {s.label}
                {s.status === "current" ? <span className="sr-only"> (current step)</span> : null}
              </p>
              {s.at ? (
                <p className="text-xs text-muted-foreground">
                  {s.at.slice(0, 16).replace("T", " ")}
                  {s.actor ? ` · ${s.actor}` : ""}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
