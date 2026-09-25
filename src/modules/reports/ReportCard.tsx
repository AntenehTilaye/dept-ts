"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { generateReportAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

// One report: what it asks for, and a button per format it offers. A format that is rendered
// here and now downloads immediately; one that needs the worker says so and appears in the list
// of runs when it is ready.

export interface ParameterField {
  name: string;
  label: string;
  type: "text" | "date" | "select" | "number";
  options?: { value: string; label: string }[];
  required?: boolean;
}

export function ReportCard({
  dept,
  reportKey,
  title,
  description,
  formats,
  fields,
}: {
  dept: string;
  reportKey: string;
  title: string;
  description?: string;
  formats: string[];
  fields: ParameterField[];
}) {
  const router = useRouter();
  const [params, setParams] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const run = (format: string) => {
    startTransition(async () => {
      const result = await generateReportAction({
        dept,
        reportKey,
        format: format as "pdf",
        params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "")),
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      if (result.data.status === "done" && result.data.url) {
        // a download is a file the browser fetches, not a page it navigates to, and the link is
        // signed for this person for five minutes
        toast.success("Ready.");
        const link = document.createElement("a");
        link.href = result.data.url;
        link.rel = "noopener";
        link.click();
      } else if (result.data.status === "done") {
        toast.success("Ready — open it from the list below.");
      } else {
        toast.success("Being prepared; it appears below when it is ready.");
      }
      router.refresh();
    });
  };

  return (
    <Card data-testid={`report-${reportKey}`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {fields.length ? (
          <div className="flex flex-wrap items-end gap-3">
            {fields.map((field) => (
              <div key={field.name} className="grid gap-1.5">
                <Label htmlFor={`${reportKey}-${field.name}`}>{field.label}</Label>
                {field.type === "select" ? (
                  <NativeSelect
                    id={`${reportKey}-${field.name}`}
                    value={params[field.name] ?? ""}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, [field.name]: e.target.value }))
                    }
                  >
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    id={`${reportKey}-${field.name}`}
                    type={field.type === "number" ? "number" : field.type}
                    className="w-44"
                    value={params[field.name] ?? ""}
                    onChange={(e) => setParams((p) => ({ ...p, [field.name]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {formats.map((format) => (
            <Button
              key={format}
              type="button"
              variant={format === "pdf" ? "default" : "outline"}
              size="sm"
              disabled={pending}
              onClick={() => run(format)}
            >
              {format.toUpperCase()}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
