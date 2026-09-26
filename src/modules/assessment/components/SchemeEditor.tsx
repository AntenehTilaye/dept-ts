"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSchemeAction } from "../actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// How a course is marked: the components, what each is out of and what each is worth. The weights
// have to add to a hundred before marks can be read against them, so the editor says where it
// stands as you type rather than refusing at the end.

export interface ComponentRow {
  key: string;
  name: string;
  maxMark: number;
  weightPercent: number;
  isFinal: boolean;
  excludedFromConsolidation?: boolean;
}

const BLANK: ComponentRow = {
  key: "",
  name: "",
  maxMark: 10,
  weightPercent: 0,
  isFinal: false,
};

export function SchemeEditor({
  dept,
  courseOfferingId,
  sectionOfferingId,
  initial,
  locked,
}: {
  dept: string;
  courseOfferingId: string;
  sectionOfferingId?: string | null;
  initial: ComponentRow[];
  locked: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ComponentRow[]>(initial.length ? initial : [BLANK]);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const total = rows.reduce(
    (sum, row) => sum + (row.excludedFromConsolidation ? 0 : Number(row.weightPercent) || 0),
    0,
  );
  const addsUp = Math.abs(total - 100) < 0.01;

  const update = (index: number, patch: Partial<ComponentRow>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveSchemeAction({
        dept,
        courseOfferingId,
        sectionOfferingId: sectionOfferingId ?? null,
        components: rows
          .filter((row) => row.key.trim() && row.name.trim())
          .map((row, index) => ({ ...row, order: index })),
      });
      if (result.ok) {
        toast.success("The scheme was saved.");
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="scheme-editor">
      {locked ? (
        <Alert role="status">
          <span>
            Marks have been committed against this scheme, so its components can no longer be
            added, removed or re-weighted. A name may still be corrected.
          </span>
        </Alert>
      ) : null}
      {message ? (
        <Alert variant="destructive" role="alert">
          <span>{message}</span>
        </Alert>
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li
            key={index}
            className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[8rem_1fr_6rem_6rem_auto]"
            data-testid={`component-${index}`}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`key-${index}`}>Key</Label>
              <Input
                id={`key-${index}`}
                value={row.key}
                disabled={locked}
                onChange={(e) => update(index, { key: e.target.value })}
                placeholder="quiz"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`name-${index}`}>Name</Label>
              <Input
                id={`name-${index}`}
                value={row.name}
                onChange={(e) => update(index, { name: e.target.value })}
                placeholder="Quiz"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`max-${index}`}>Out of</Label>
              <Input
                id={`max-${index}`}
                type="number"
                min={1}
                value={row.maxMark}
                disabled={locked}
                onChange={(e) => update(index, { maxMark: Number(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`weight-${index}`}>Worth %</Label>
              <Input
                id={`weight-${index}`}
                type="number"
                min={0}
                max={100}
                value={row.weightPercent}
                disabled={locked}
                onChange={(e) => update(index, { weightPercent: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-end gap-3">
              <Label className="flex items-center gap-2 text-sm font-normal">
                <Checkbox
                  checked={row.isFinal}
                  disabled={locked}
                  onCheckedChange={(v) => update(index, { isFinal: v === true })}
                />
                Final
              </Label>
              {!locked && rows.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        {!locked ? (
          <Button type="button" variant="outline" onClick={() => setRows((c) => [...c, BLANK])}>
            Add a component
          </Button>
        ) : null}
        <Badge variant={addsUp ? "secondary" : "destructive"} data-testid="scheme-weight">
          {total}% of 100
        </Badge>
        {!addsUp ? (
          <span className="text-sm text-muted-foreground">
            Marks can only be read once the components add up to a hundred.
          </span>
        ) : null}
        <Button type="button" onClick={save} disabled={pending} className="ml-auto">
          {pending ? "Saving…" : "Save the scheme"}
        </Button>
      </div>
    </div>
  );
}
