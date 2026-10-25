/**
 * Business-hours scheduling. A recipient should get a B2B email during their working day, so each
 * message is only sent inside a window (default Mon-Fri 09:00-17:00) in the campaign timezone --
 * or the lead own timezone when we know it (lead.contact.timezone).
 */

export type SendWindow = {
  timezone: string;
  startHour: number; // inclusive, 0-23
  endHour: number; // exclusive, 1-24
  weekdaysOnly: boolean;
};

const STEP_MS = 5 * 60_000;
const MAX_LOOKAHEAD_STEPS = (8 * 24 * 60) / 5; // a bit over a week

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local wall-clock parts of an instant in a timezone. */
export function localParts(date: Date, timezone: string): { hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

export function isInsideWindow(date: Date, window: SendWindow): boolean {
  const tz = isValidTimezone(window.timezone) ? window.timezone : "UTC";
  const { hour, weekday } = localParts(date, tz);
  if (window.weekdaysOnly && (weekday === 0 || weekday === 6)) return false;
  return hour >= window.startHour && hour < window.endHour;
}

/** The earliest instant at or after `from` that falls inside the send window. */
export function nextAllowedTime(from: Date, window: SendWindow): Date {
  if (isInsideWindow(from, window)) return from;
  // Walk forward in 5-minute steps (robust to DST changes) until the window opens.
  const aligned = Math.ceil(from.getTime() / STEP_MS) * STEP_MS;
  for (let i = 0; i < MAX_LOOKAHEAD_STEPS; i++) {
    const candidate = new Date(aligned + i * STEP_MS);
    if (isInsideWindow(candidate, window)) return candidate;
  }
  // Degenerate window (e.g. start >= end): do not loop forever, just wait a day.
  return new Date(from.getTime() + 24 * 60 * 60_000);
}

/** Daily cap after the warm-up ramp: starts at 20% and reaches the full cap after 14 days. */
export function effectiveDailyCap(dailyCap: number, warmupStartedAt: Date | null, now: Date): number {
  if (!warmupStartedAt) return dailyCap;
  const days = Math.max(0, Math.floor((now.getTime() - warmupStartedAt.getTime()) / 86_400_000));
  const fraction = Math.min(1, 0.2 + (0.8 * days) / 14);
  return Math.max(1, Math.floor(dailyCap * fraction));
}
