import { CheckCircle2Icon, CircleDashedIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { UploadButton } from "./UploadButton";

export interface SlotCard {
  slotKey: string;
  label: string;
  required?: boolean;
  satisfied: boolean;
  documentId?: string;
  documentTitle?: string;
}

/**
 * Deliverable slots of a subject (task deliverables, portfolio parts): one card per expected
 * slot showing satisfied/missing, with an upload that links straight into the slot.
 */
export function AttachmentSlots({
  dept,
  subject,
  slots,
  canUpload,
}: {
  dept: string;
  subject: { subjectType: string; subjectId: string };
  slots: SlotCard[];
  canUpload: boolean;
}) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="attachment-slots">
      {slots.map((s) => (
        <li
          key={s.slotKey}
          data-testid={`slot-${s.slotKey}`}
          data-satisfied={s.satisfied ? "true" : "false"}
          className={cn(
            "flex items-center justify-between gap-3 rounded-md border p-3 text-sm",
            s.satisfied
              ? "border-emerald-500/40"
              : s.required
                ? "border-dashed"
                : "border-dashed opacity-90",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            {s.satisfied ? (
              <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <CircleDashedIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0">
              <p className="font-medium">
                {s.label}
                {s.required ? <span className="text-destructive"> *</span> : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {s.satisfied ? (s.documentTitle ?? "Provided") : "Missing"}
              </p>
            </div>
          </div>
          {canUpload ? (
            <UploadButton
              dept={dept}
              size="sm"
              label={s.satisfied ? "Replace" : "Upload"}
              {...(s.satisfied && s.documentId
                ? { documentId: s.documentId }
                : { links: [{ ...subject, linkRole: "deliverable", slotKey: s.slotKey }] })}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
