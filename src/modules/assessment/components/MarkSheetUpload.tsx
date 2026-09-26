"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { toast } from "sonner";
import { startMarkImportAction } from "../actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

// Handing in a sheet. The file is read here and the import it starts is an ordinary `import_batch`
// record, so what follows — the columns, the preview, the fixes, the commit — happens on the
// import's own pages rather than being built a second time here.

export function MarkSheetUpload({
  dept,
  sectionOfferingId,
  disabled,
  disabledReason,
}: {
  dept: string;
  sectionOfferingId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"assessment" | "attendance">("assessment");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const submit = (file: File) => {
    setMessage(null);
    startTransition(async () => {
      const bytes = Buffer.from(await file.arrayBuffer()).toString("base64");
      const result = await startMarkImportAction({
        dept,
        sectionOfferingId,
        kind,
        fileName: file.name,
        bytes,
        mimeType: file.type || "application/octet-stream",
      });
      if (result.ok) {
        toast.success(`${file.name} was read; check the columns.`);
        router.push(`/d/${dept}/imports/${result.data.recordId}` as Route);
        return;
      }
      setMessage(result.message);
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="mark-sheet-upload">
      {message ? (
        <Alert variant="destructive" role="alert">
          <span>{message}</span>
        </Alert>
      ) : null}
      {disabled ? (
        <Alert role="status">
          <span>{disabledReason ?? "This section cannot be marked at the moment."}</span>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sheet-kind">What is on the sheet</Label>
          <NativeSelect
            id="sheet-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "assessment" | "attendance")}
          >
            <option value="assessment">Marks</option>
            <option value="attendance">Attendance</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sheet-file">The file</Label>
          <input
            ref={input}
            id="sheet-file"
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={disabled || pending}
            className="text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) submit(file);
              e.target.value = "";
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          asChild
          className={disabled ? "pointer-events-none opacity-50" : undefined}
        >
          <a href={`/d/${dept}/assessment/${sectionOfferingId}/template?kind=${kind}`}>
            Download the template
          </a>
        </Button>
      </div>
      {pending ? <p className="text-sm text-muted-foreground">Reading the file…</p> : null}
    </div>
  );
}
