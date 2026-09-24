import { CalendarClockIcon } from "lucide-react";
import type { Route } from "next";
import { dbOf, pageContext } from "@/lib/auth/page";
import { partsIn } from "@/lib/time";
import { blocksFor, freeSlots, occurrencesOf, policiesOf, slotLabel } from "@/platform/availability";
import { EmptyState } from "@/components/patterns/EmptyState";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SegmentedLinks } from "@/components/patterns/SegmentedLinks";
import { WeekCalendar } from "@/components/availability/WeekCalendar";
import { PolicyForm, type PolicyFormValues } from "@/modules/availability/PolicyForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Your own time: what you are willing to be booked for, what is already booked, and what is
// therefore free. The three answer each other, so they share one page.

const PURPOSES = ["appointments", "invigilation", "leave"] as const;
type Purpose = (typeof PURPOSES)[number];

const PURPOSE_LABELS: Record<Purpose, string> = {
  appointments: "Appointments",
  invigilation: "Invigilation",
  leave: "Leave",
};

export default async function AvailabilityPage(props: PageProps<"/d/[dept]/availability">) {
  const { dept } = await props.params;
  const params = await props.searchParams;
  const ctx = await pageContext(dept);
  const db = dbOf(ctx);
  const raw = typeof params.purpose === "string" ? params.purpose : "appointments";
  const purpose = (PURPOSES as readonly string[]).includes(raw) ? (raw as Purpose) : "appointments";

  if (!ctx.personId) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="My availability" description="When you can be booked." />
        <EmptyState
          title="Your account is not linked to a person record"
          hint="Nothing can be scheduled for you until an administrator links your account."
        />
      </div>
    );
  }

  const now = new Date();
  const weekStart = mondayOf(now);
  // the calendar shows the week somebody is in; the preview looks forward from now, because a
  // slot that has already passed is not free
  const thisWeek = { from: weekStart, to: new Date(weekStart.getTime() + 7 * 86_400_000) };
  const ahead = { from: now, to: new Date(now.getTime() + 14 * 86_400_000) };

  const [policies, blocks, slots] = await Promise.all([
    policiesOf(db, ctx.departmentId, ctx.personId),
    blocksFor(db, ctx.departmentId, { ownerType: "person", ownerId: ctx.personId }, thisWeek),
    freeSlots(db, ctx.departmentId, ctx.personId, ahead, purpose, now),
  ]);
  const current = policies.find((p) => p.purpose === purpose);
  const timezone = current?.timezone ?? "Africa/Addis_Ababa";

  const initial: PolicyFormValues = {
    purpose,
    weeklyWindows: current?.weeklyWindows ?? [],
    breakWindows: current?.breakWindows ?? [],
    blackoutPeriods: (current?.blackoutPeriods ?? []).map((b) => ({
      fromAt: b.fromAt.toISOString().slice(0, 16),
      toAt: b.toAt.toISOString().slice(0, 16),
      reason: b.reason ?? "",
    })),
    slotMinutes: current?.slotMinutes ?? 30,
    maxPerPeriod: current?.maxPerPeriod ?? null,
    validFrom: (current?.validFrom ?? now).toISOString().slice(0, 10),
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My availability"
        description="The hours you offer, the days you are away, and what that leaves free. Everything already booked for you is shown beside it."
        actions={
          <SegmentedLinks
            label="Purpose"
            items={PURPOSES.map((p) => ({
              label: PURPOSE_LABELS[p],
              href: `/d/${dept}/availability?purpose=${p}` as Route,
              active: p === purpose,
            }))}
          />
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{PURPOSE_LABELS[purpose]}</CardTitle>
            <CardDescription>
              {current
                ? `In force since ${current.validFrom.toISOString().slice(0, 10)}.`
                : "You have not declared anything for this purpose yet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PolicyForm dept={dept} initial={initial} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Free in the next two weeks</CardTitle>
              <CardDescription>
                Your openings, minus your breaks, minus everything already booked.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {slots.length === 0 ? (
                <EmptyState
                  icon={<CalendarClockIcon />}
                  title="Nothing free"
                  hint={
                    current
                      ? "Every opening is taken, or the days you are away cover them."
                      : "Add the hours you offer and they will appear here."
                  }
                />
              ) : (
                <ul className="flex flex-wrap gap-1.5" data-testid="free-slots">
                  {slots.slice(0, 40).map((slot) => (
                    <li
                      key={slot.from.toISOString()}
                      className="rounded-md border px-2 py-1 text-xs tabular-nums"
                    >
                      {slotLabel(slot, timezone)}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>This week</CardTitle>
              <CardDescription>
                Everything the department has booked for you, whoever booked it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WeekCalendar
                blocks={blocks.flatMap((b) =>
                  // a weekly class is one row that stands for every week of its term, so the
                  // calendar shows the occurrences that fall in the week being looked at
                  occurrencesOf(b, thisWeek).map((occurrence, index) => ({
                    id: `${b.id}-${index}`,
                    kind: b.kind,
                    severity: b.severity,
                    startAt: occurrence.from,
                    endAt: occurrence.to,
                  })),
                )}
                weekStart={weekStart}
                timezone={timezone}
                emptyHint="Nothing is booked for you this week."
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Monday 00:00 of the week an instant falls in, in the department's timezone. */
function mondayOf(now: Date, timezone = "Africa/Addis_Ababa"): Date {
  const p = partsIn(now, timezone);
  const isoWeekday = p.weekday === 0 ? 7 : p.weekday;
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day));
  monday.setUTCDate(monday.getUTCDate() - (isoWeekday - 1));
  return monday;
}
