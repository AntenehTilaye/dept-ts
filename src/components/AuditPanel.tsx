import type { HistoryEntry } from "@/platform/audit/history";
import { fmtDateTime } from "@/components/forms/Field";

function str(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (v instanceof Date) return v.toISOString();
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** A subject's timeline (audit rows and workflow transitions merged). */
export function AuditPanel({
  entries,
  actorNames = {},
}: {
  entries: HistoryEntry[];
  actorNames?: Record<string, string>;
}) {
  return (
    <ol className="flex flex-col gap-2 text-sm" data-testid="audit-panel">
      {entries.map((e) => (
        <li key={e.id} className="rounded-md border px-3 py-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {e.kind === "transition" ? `${e.fromState} → ${e.toState}` : e.action}
              {e.branchKey ? ` (${e.branchKey})` : ""}
            </span>
            <span>
              {e.actorUserId ? (actorNames[e.actorUserId] ?? e.actorUserId) : "system"} ·{" "}
              {fmtDateTime(e.at)}
            </span>
          </div>
          {e.comment ? <p>{e.comment}</p> : null}
          {e.changes ? (
            <ul className="text-xs">
              {Object.entries(e.changes).map(([k, v]) => (
                <li key={k}>
                  <span className="font-mono">{k}</span>: {str(v.before)} → {str(v.after)}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
      {entries.length === 0 ? <li className="text-muted-foreground">No history yet.</li> : null}
    </ol>
  );
}
