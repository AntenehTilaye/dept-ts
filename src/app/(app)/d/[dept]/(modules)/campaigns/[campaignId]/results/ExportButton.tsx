"use client";

import { useTransition } from "react";
import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { downloadUrlAction } from "@/app/(app)/d/[dept]/(modules)/documents/actions";
import { Button } from "@/components/ui/button";
import { exportResultsAction, recomputeResultsAction } from "./actions";

/** Recompute the aggregation, or export it as a CSV document and download it straight away. */
export function ExportButton({ dept, campaignId }: { dept: string; campaignId: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await recomputeResultsAction({ dept, campaignId });
            if (r.ok) toast.success(`Recomputed ${r.data.cells} cells`);
            else toast.error(r.message);
          })
        }
      >
        <RefreshCwIcon /> Recompute
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await exportResultsAction({ dept, campaignId });
            if (!r.ok) {
              toast.error(r.message);
              return;
            }
            const link = await downloadUrlAction({ dept, documentId: r.data.documentId });
            if (link.ok) window.location.assign(link.data.url);
            else toast.error(link.message);
          })
        }
      >
        <DownloadIcon /> Export CSV
      </Button>
    </div>
  );
}
