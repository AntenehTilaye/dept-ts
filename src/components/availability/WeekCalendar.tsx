import { partsIn } from "@/lib/time";
import { cn } from "@/lib/utils";

// A week of somebody's (or some room's) busy time. It is a list per day rather than a pixel
// grid: the blocks of a department week are few and readable as text, a list works on a phone
// without horizontal scrolling, and a screen reader reads it in the order the day happens.

export interface CalendarBlock {
  id: string;
  kind: string;
  severity: string;
  startAt: Date;
  endAt: Date;
  label?: string | null;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function WeekCalendar({
  blocks,
  weekStart,
  timezone,
  emptyHint = "Nothing is booked this week.",
}: {
  blocks: CalendarBlock[];
  /** Monday of the week being shown. */
  weekStart: Date;
  timezone: string;
  emptyHint?: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const from = new Date(weekStart.getTime() + i * 86_400_000);
    const to = new Date(from.getTime() + 86_400_000);
    return {
      label: DAYS[i]!,
      date: from,
      blocks: blocks
        .filter((b) => b.startAt < to && b.endAt > from)
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
    };
  });
  const total = days.reduce((n, d) => n + d.blocks.length, 0);

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">{emptyHint}</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="week-calendar">
      {days.map((day) => (
        <section key={day.label} className="rounded-lg border p-3" aria-label={day.label}>
          <h3 className="text-xs font-medium text-muted-foreground">
            {day.label}{" "}
            <span className="tabular-nums">{day.date.toISOString().slice(5, 10)}</span>
          </h3>
          {day.blocks.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Free</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {day.blocks.map((block) => (
                <li
                  key={block.id}
                  data-testid={`block-${block.id}`}
                  data-kind={block.kind}
                  className={cn(
                    "rounded-md border-l-4 bg-muted/40 px-2 py-1 text-xs",
                    block.severity === "hard" ? "border-l-primary" : "border-l-muted-foreground/40",
                  )}
                >
                  <span className="font-medium tabular-nums">
                    {hhmm(block.startAt, timezone)}–{hhmm(block.endAt, timezone)}
                  </span>{" "}
                  <span className="text-muted-foreground">{block.label ?? block.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function hhmm(date: Date, timezone: string): string {
  const p = partsIn(date, timezone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
