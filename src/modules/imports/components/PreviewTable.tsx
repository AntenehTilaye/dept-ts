"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { fixImportRowAction, skipImportRowAction } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// The file as it will be committed, with what is wrong beside the line that has it. A line is
// corrected here rather than in the spreadsheet, because the person who can fix it is looking
// at the error, not at the file.

export interface PreviewRow {
  rowNo: number;
  values: Record<string, unknown>;
  errors: { field?: string; message: string }[];
  warnings: { field?: string; message: string }[];
  skipped: boolean;
}

export function PreviewTable({
  dept,
  batchId,
  columns,
  rows,
  editable,
}: {
  dept: string;
  batchId: string;
  /** The headers of the file, in the order it has them. */
  columns: string[];
  rows: PreviewRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [patch, setPatch] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const save = (rowNo: number) => {
    startTransition(async () => {
      const result = await fixImportRowAction({ dept, batchId, rowNo, patch });
      if (result.ok) {
        toast.success(`Row ${rowNo} corrected; the file was checked again.`);
        setEditing(null);
        setPatch({});
        router.refresh();
        return;
      }
      toast.error(result.message);
    });
  };

  const skip = (rowNo: number) => {
    startTransition(async () => {
      const result = await skipImportRowAction({ dept, batchId, rowNo });
      if (result.ok) {
        toast.success(`Row ${rowNo} will be left out.`);
        router.refresh();
        return;
      }
      toast.error(result.message);
    });
  };

  if (!rows.length) return <p className="text-sm text-muted-foreground">There are no rows yet.</p>;

  return (
    <div className="overflow-x-auto" data-testid="import-preview">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            {columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
            <TableHead>Problems</TableHead>
            {editable ? <TableHead className="w-40">Fix</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.rowNo}
              data-testid={`import-row-${row.rowNo}`}
              data-state={row.errors.length ? "error" : row.warnings.length ? "warning" : "ok"}
              className={cn(
                row.errors.length && "bg-destructive/5",
                row.skipped && "opacity-50 line-through",
              )}
            >
              <TableCell className="tabular-nums text-muted-foreground">{row.rowNo}</TableCell>
              {columns.map((column) => (
                <TableCell key={column} className="max-w-48 truncate">
                  {editing === row.rowNo ? (
                    <Input
                      aria-label={column}
                      defaultValue={String(row.values[column] ?? "")}
                      onChange={(e) => setPatch((p) => ({ ...p, [column]: e.target.value }))}
                    />
                  ) : (
                    String(row.values[column] ?? "")
                  )}
                </TableCell>
              ))}
              <TableCell>
                <ul className="flex flex-col gap-1">
                  {row.errors.map((issue, i) => (
                    <li key={`e${i}`}>
                      <Badge variant="destructive">{issue.message}</Badge>
                    </li>
                  ))}
                  {row.warnings.map((issue, i) => (
                    <li key={`w${i}`}>
                      <Badge variant="outline">{issue.message}</Badge>
                    </li>
                  ))}
                </ul>
              </TableCell>
              {editable ? (
                <TableCell>
                  {editing === row.rowNo ? (
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => save(row.rowNo)} disabled={pending}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(row.rowNo);
                          setPatch({});
                        }}
                      >
                        Edit
                      </Button>
                      {row.errors.length ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => skip(row.rowNo)}
                          disabled={pending}
                        >
                          Leave out
                        </Button>
                      ) : null}
                    </div>
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
