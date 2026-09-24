// Wall-clock arithmetic in a named timezone, with no dependency beyond Intl. A department works
// in local time — "Tuesday 09:00" is a fact about its clock, not about UTC — so anything that
// turns a written time into an instant goes through here.

export interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday, as JavaScript counts. */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The wall-clock parts of an instant in a timezone. */
export function partsIn(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const got: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) got[p.type] = p.value;
  return {
    year: Number(got.year),
    month: Number(got.month),
    day: Number(got.day),
    hour: Number(got.hour === "24" ? "0" : got.hour),
    minute: Number(got.minute),
    second: Number(got.second),
    weekday: Math.max(0, WEEKDAYS.indexOf(got.weekday ?? "Sun")),
  };
}

/** The offset of a timezone at an instant, in minutes east of UTC. */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** The instant at which a timezone's wall clock shows the given parts. */
export function instantOf(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second?: number;
  },
  timeZone: string,
): Date {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
  );
  // two passes converge for every real zone (the first offset may belong to the wrong side of a shift)
  let guess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - offsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/** "HH:MM" → minutes since midnight; anything else is 0. */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h! * 60 + m!;
}

/** The instant of a written time on the local calendar day an instant falls in. */
export function atLocalTime(day: Date, hhmm: string, timeZone: string): Date {
  const p = partsIn(day, timeZone);
  const minutes = minutesOfDay(hhmm);
  return instantOf(
    { year: p.year, month: p.month, day: p.day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
    timeZone,
  );
}

/** ISO weekday (1 = Monday … 7 = Sunday) of an instant in a timezone. */
export function isoWeekday(date: Date, timeZone: string): number {
  const w = partsIn(date, timeZone).weekday;
  return w === 0 ? 7 : w;
}
