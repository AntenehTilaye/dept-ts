"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { savePolicyAction } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { FormSection } from "@/components/patterns/FormSection";

// Declaring availability is three small lists — the hours offered, the breaks kept, the days
// away — so the form is three repeating rows rather than a wizard. Everything is editable in
// place and saved in one action, because that is how somebody actually thinks about their week.

export interface PolicyFormValues {
  purpose: "appointments" | "invigilation" | "leave";
  weeklyWindows: { weekday: number; from: string; to: string }[];
  breakWindows: { weekday?: number; from: string; to: string }[];
  blackoutPeriods: { fromAt: string; toAt: string; reason?: string }[];
  slotMinutes: number | null;
  maxPerPeriod: number | null;
  validFrom: string;
}

const DAYS = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
] as const;

export function PolicyForm({ dept, initial }: { dept: string; initial: PolicyFormValues }) {
  const router = useRouter();
  const [values, setValues] = useState<PolicyFormValues>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof PolicyFormValues>(key: K, value: PolicyFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const submit = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await savePolicyAction({ dept, ...values });
      if (result.ok) {
        toast.success("Your availability is saved.");
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  return (
    <div className="grid gap-4" data-testid="policy-form">
      {message ? (
        <Alert variant="destructive" role="alert">
          <span>{message}</span>
        </Alert>
      ) : null}

      <FormSection
        title="Hours you offer"
        description="The windows somebody may book. Times are your department's local time."
      >
        {values.weeklyWindows.map((window, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2" data-testid={`window-${index}`}>
            <div className="grid gap-1.5">
              <Label htmlFor={`window-day-${index}`}>Day</Label>
              <NativeSelect
                id={`window-day-${index}`}
                value={String(window.weekday)}
                onChange={(e) =>
                  set(
                    "weeklyWindows",
                    values.weeklyWindows.map((w, i) =>
                      i === index ? { ...w, weekday: Number(e.target.value) } : w,
                    ),
                  )
                }
              >
                {DAYS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <TimeField
              id={`window-from-${index}`}
              label="From"
              value={window.from}
              onChange={(from) =>
                set(
                  "weeklyWindows",
                  values.weeklyWindows.map((w, i) => (i === index ? { ...w, from } : w)),
                )
              }
            />
            <TimeField
              id={`window-to-${index}`}
              label="To"
              value={window.to}
              onChange={(to) =>
                set(
                  "weeklyWindows",
                  values.weeklyWindows.map((w, i) => (i === index ? { ...w, to } : w)),
                )
              }
            />
            <RemoveButton
              label={`Remove window ${index + 1}`}
              onClick={() =>
                set(
                  "weeklyWindows",
                  values.weeklyWindows.filter((_, i) => i !== index),
                )
              }
            />
          </div>
        ))}
        <AddButton
          label="Add an opening"
          onClick={() =>
            set("weeklyWindows", [...values.weeklyWindows, { weekday: 2, from: "09:00", to: "12:00" }])
          }
        />
      </FormSection>

      <FormSection
        title="Breaks"
        description="Carved out of every opening; leave the day empty to apply it to all of them."
      >
        {values.breakWindows.map((brk, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2" data-testid={`break-${index}`}>
            <div className="grid gap-1.5">
              <Label htmlFor={`break-day-${index}`}>Day</Label>
              <NativeSelect
                id={`break-day-${index}`}
                value={brk.weekday ? String(brk.weekday) : ""}
                onChange={(e) =>
                  set(
                    "breakWindows",
                    values.breakWindows.map((b, i) =>
                      i === index
                        ? { ...b, weekday: e.target.value ? Number(e.target.value) : undefined }
                        : b,
                    ),
                  )
                }
              >
                <option value="">Every day</option>
                {DAYS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <TimeField
              id={`break-from-${index}`}
              label="From"
              value={brk.from}
              onChange={(from) =>
                set(
                  "breakWindows",
                  values.breakWindows.map((b, i) => (i === index ? { ...b, from } : b)),
                )
              }
            />
            <TimeField
              id={`break-to-${index}`}
              label="To"
              value={brk.to}
              onChange={(to) =>
                set(
                  "breakWindows",
                  values.breakWindows.map((b, i) => (i === index ? { ...b, to } : b)),
                )
              }
            />
            <RemoveButton
              label={`Remove break ${index + 1}`}
              onClick={() =>
                set(
                  "breakWindows",
                  values.breakWindows.filter((_, i) => i !== index),
                )
              }
            />
          </div>
        ))}
        <AddButton
          label="Add a break"
          onClick={() => set("breakWindows", [...values.breakWindows, { from: "12:00", to: "13:00" }])}
        />
      </FormSection>

      <FormSection
        title="Days away"
        description="Leave, travel or anything else that makes you unavailable. These become busy time everybody else's scheduling respects."
      >
        {values.blackoutPeriods.map((away, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2" data-testid={`away-${index}`}>
            <div className="grid gap-1.5">
              <Label htmlFor={`away-from-${index}`}>From</Label>
              <Input
                id={`away-from-${index}`}
                type="datetime-local"
                value={away.fromAt}
                onChange={(e) =>
                  set(
                    "blackoutPeriods",
                    values.blackoutPeriods.map((a, i) =>
                      i === index ? { ...a, fromAt: e.target.value } : a,
                    ),
                  )
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`away-to-${index}`}>To</Label>
              <Input
                id={`away-to-${index}`}
                type="datetime-local"
                value={away.toAt}
                onChange={(e) =>
                  set(
                    "blackoutPeriods",
                    values.blackoutPeriods.map((a, i) =>
                      i === index ? { ...a, toAt: e.target.value } : a,
                    ),
                  )
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`away-reason-${index}`}>Reason</Label>
              <Input
                id={`away-reason-${index}`}
                value={away.reason ?? ""}
                placeholder="Conference"
                onChange={(e) =>
                  set(
                    "blackoutPeriods",
                    values.blackoutPeriods.map((a, i) =>
                      i === index ? { ...a, reason: e.target.value } : a,
                    ),
                  )
                }
              />
            </div>
            <RemoveButton
              label={`Remove the day away ${index + 1}`}
              onClick={() =>
                set(
                  "blackoutPeriods",
                  values.blackoutPeriods.filter((_, i) => i !== index),
                )
              }
            />
          </div>
        ))}
        <AddButton
          label="Add a day away"
          onClick={() =>
            set("blackoutPeriods", [
              ...values.blackoutPeriods,
              { fromAt: defaultDay(), toAt: defaultDay(1), reason: "" },
            ])
          }
        />
      </FormSection>

      <FormSection title="How it is booked">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="slot-minutes">Slot length</Label>
            <NativeSelect
              id="slot-minutes"
              value={values.slotMinutes ? String(values.slotMinutes) : ""}
              onChange={(e) => set("slotMinutes", e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">The whole opening</option>
              {[15, 20, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="max-per-period">Most per day</Label>
            <Input
              id="max-per-period"
              type="number"
              min={1}
              className="w-32"
              value={values.maxPerPeriod ?? ""}
              onChange={(e) => set("maxPerPeriod", e.target.value ? Number(e.target.value) : null)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="valid-from">In force from</Label>
            <Input
              id="valid-from"
              type="date"
              value={values.validFrom}
              onChange={(e) => set("validFrom", e.target.value)}
            />
          </div>
        </div>
      </FormSection>

      <div className="flex justify-end">
        <Button type="button" onClick={submit} disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Save availability"}
        </Button>
      </div>
    </div>
  );
}

function TimeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="time"
        className="w-32"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div>
      <Button type="button" variant="outline" size="sm" onClick={onClick}>
        <PlusIcon /> {label}
      </Button>
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" aria-label={label} onClick={onClick}>
      <XIcon />
    </Button>
  );
}

/** A sensible default for a new day away: tomorrow, 08:00 to 17:00. */
function defaultDay(offsetDays = 0): string {
  const day = new Date(Date.now() + (offsetDays + 1) * 86_400_000);
  day.setUTCHours(offsetDays ? 17 : 8, 0, 0, 0);
  return day.toISOString().slice(0, 16);
}
