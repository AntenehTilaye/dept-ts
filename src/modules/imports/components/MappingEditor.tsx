"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveMappingAction } from "../actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

// Which column of the file is which field. The guess is already made; this is where somebody
// corrects it, and saves the correction as a profile so the same file never has to be explained
// twice.

export interface MappingField {
  field: string;
  label: string;
  required: boolean;
  header: string | null;
}

export function MappingEditor({
  dept,
  batchId,
  fields,
  headers,
  unmapped,
  profiles,
}: {
  dept: string;
  batchId: string;
  fields: MappingField[];
  headers: string[];
  unmapped: string[];
  profiles: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [mappings, setMappings] = useState<Record<string, string>>(
    Object.fromEntries(fields.filter((f) => f.header).map((f) => [f.field, f.header!])),
  );
  const [profileName, setProfileName] = useState("");
  const [pending, startTransition] = useTransition();

  const missing = fields.filter((f) => f.required && !mappings[f.field]);

  const save = () => {
    startTransition(async () => {
      const result = await saveMappingAction({
        dept,
        batchId,
        mappings,
        ...(profileName.trim() ? { profileName: profileName.trim() } : {}),
      });
      if (result.ok) {
        toast.success(profileName ? "Saved, and kept as a profile." : "Saved.");
        router.refresh();
        return;
      }
      toast.error(result.message);
    });
  };

  return (
    <div className="grid gap-4" data-testid="mapping-editor">
      {missing.length ? (
        <Alert variant="destructive" role="alert">
          <span>
            The file has no column for {missing.map((f) => f.label).join(", ")}. Choose one, or
            upload a file that has it.
          </span>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.field} className="grid gap-1.5" data-testid={`map-${field.field}`}>
            <Label htmlFor={`map-${field.field}`}>
              {field.label}
              {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
            </Label>
            <NativeSelect
              id={`map-${field.field}`}
              value={mappings[field.field] ?? ""}
              onChange={(e) =>
                setMappings((m) => {
                  const next = { ...m };
                  if (e.target.value) next[field.field] = e.target.value;
                  else delete next[field.field];
                  return next;
                })
              }
            >
              <option value="">(not in this file)</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>

      {unmapped.length ? (
        <p className="text-xs text-muted-foreground">
          Columns nothing uses:{" "}
          {unmapped.map((header) => (
            <Badge key={header} variant="secondary" className="mr-1">
              {header}
            </Badge>
          ))}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="profile-name">Remember this as</Label>
          <Input
            id="profile-name"
            placeholder="Registrar's roster"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            className="w-64"
          />
        </div>
        <Button type="button" onClick={save} disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Save the columns"}
        </Button>
      </div>

      {profiles.length ? (
        <p className="text-xs text-muted-foreground">
          Saved profiles: {profiles.map((p) => p.name).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
