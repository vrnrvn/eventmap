import { instantToPickerDate, isValidTimeZone, pickerDateToInstant } from '@/utils/timezone';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

export type RecurrencePattern = {
  frequency: RecurrenceFrequency;
  interval: number;
  endDate?: string;
};

export type RecurrenceOption = RecurrencePattern | null;

export const RECURRENCE_OPTIONS: { value: RecurrenceOption; label: string }[] = [
  { value: null, label: 'None' },
  { value: { frequency: 'daily', interval: 1 }, label: 'Every Day' },
  { value: { frequency: 'weekly', interval: 1 }, label: 'Every Week' },
  { value: { frequency: 'monthly', interval: 1 }, label: 'Every Month' },
];

export function getRecurrenceLabel(pattern: RecurrencePattern | null | undefined): string {
  if (!pattern) return '';
  const opt = RECURRENCE_OPTIONS.find(
    (o) =>
      o.value &&
      o.value.frequency === pattern.frequency &&
      o.value.interval === pattern.interval
  );
  return opt?.label ?? `${pattern.interval} ${pattern.frequency}`;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Local calendar date → 'YYYY-MM-DD' for `RecurrencePattern.endDate`. Uses
 * local components (not toISOString) so a date picked in the evening west of
 * UTC doesn't roll over to the next day.
 */
export function toRecurrenceEndDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse a `RecurrencePattern.endDate` into a local-midnight Date, or null. */
export function parseRecurrenceEndDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = parseDateOnly(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateOnly(s: string): Date {
  // Parse 'YYYY-MM-DD' into LOCAL date components (matches utils/eventStatus.ts)
  // so the end date doesn't land a day early west of UTC.
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    return new Date(y, m - 1, d);
  }
  const fallback = new Date(s);
  fallback.setHours(0, 0, 0, 0);
  return fallback;
}

function sameDayOfWeek(d1: Date, d2: Date): boolean {
  return d1.getDay() === d2.getDay();
}

export function isEventOnDate(
  event: {
    start_datetime: string;
    is_recurring?: boolean;
    recurrence_pattern?: RecurrencePattern | null;
  },
  date: Date
): boolean {
  const start = new Date(event.start_datetime);
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  const checkStart = new Date(start);
  checkStart.setHours(0, 0, 0, 0);

  if (!event.is_recurring || !event.recurrence_pattern) {
    return toDateOnly(checkStart) === toDateOnly(checkDate);
  }

  const pattern = event.recurrence_pattern;
  const endDate = pattern.endDate ? parseDateOnly(pattern.endDate) : null;

  if (checkDate < checkStart) return false;
  if (endDate && checkDate > endDate) return false;

  const startDay = checkStart.getTime();
  const checkDay = checkDate.getTime();
  // Round, don't floor: both timestamps are local midnights, so a DST
  // transition inside the span makes the diff a non-integer number of days
  // (±1h). Flooring undercounted by one day after spring-forward, flipping
  // the parity of every daily/weekly series with interval > 1.
  const diffDays = Math.round((checkDay - startDay) / (24 * 60 * 60 * 1000));

  switch (pattern.frequency) {
    case 'daily':
      return diffDays % pattern.interval === 0;
    case 'weekly':
      return sameDayOfWeek(start, checkDate) && Math.floor(diffDays / 7) % pattern.interval === 0;
    case 'monthly': {
      // Honor `interval` via whole-month arithmetic (year*12 + month), since a
      // day-diff can't express "every N months".
      const monthsDiff =
        (checkDate.getFullYear() - checkStart.getFullYear()) * 12 +
        (checkDate.getMonth() - checkStart.getMonth());
      if (monthsDiff % pattern.interval !== 0) return false;
      // Clamp to the last day of short months so a series on the 29th/30th/31st
      // doesn't silently skip them — e.g. a "31st" series fires Feb 28 (Feb 29
      // in leap years), Apr 30, etc. Months long enough use the start day as-is.
      const daysInMonth = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 0).getDate();
      const targetDay = Math.min(checkStart.getDate(), daysInMonth);
      return checkDate.getDate() === targetDay;
    }
    default:
      return false;
  }
}

/**
 * Get the next N occurrence dates for a recurring event, starting from today.
 *
 * With an event zone (20261103140000) the series is walked on that zone's
 * calendar: the pattern is applied to the start's wall clock *in the event
 * zone* and each occurrence is converted back to an instant, so a 7 pm Lisbon
 * class stays 7 pm Lisbon for a viewer in New York across either zone's DST
 * change. Without a zone the device calendar is used (legacy behaviour).
 */
export function getNextOccurrences(
  event: {
    start_datetime: string;
    is_recurring?: boolean;
    recurrence_pattern?: RecurrencePattern | null;
    timezone?: string | null;
  },
  maxCount: number = 5,
  now: Date = new Date()
): Date[] {
  if (!event.is_recurring || !event.recurrence_pattern) return [];

  const zone = event.timezone && isValidTimeZone(event.timezone) ? event.timezone : null;
  if (zone) {
    // Re-express the start as a device-local Date carrying the event-zone
    // wall clock, run the same local-day walk from "today in the event zone",
    // then map each result back to a real instant.
    const zonedStart = instantToPickerDate(new Date(event.start_datetime), zone);
    const zonedNow = instantToPickerDate(now, zone);
    return getNextOccurrences(
      { ...event, start_datetime: zonedStart.toISOString(), timezone: null },
      maxCount,
      zonedNow
    ).map((wall) => pickerDateToInstant(wall, zone));
  }

  const start = new Date(event.start_datetime);
  const pattern = event.recurrence_pattern;
  const endDate = pattern.endDate ? parseDateOnly(pattern.endDate) : null;

  const results: Date[] = [];
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);

  // Cap the day-walk so a malformed pattern (e.g. interval 0 or a start far in
  // the future) can't spin this loop forever; return whatever was found.
  const MAX_DAY_ITERATIONS = 731;
  let iterations = 0;

  // Local midnight of the start day (toDateOnly would use the UTC date, which
  // skips the true first day for evening starts west of UTC).
  const startMidnight = new Date(start);
  startMidnight.setHours(0, 0, 0, 0);

  for (
    let d = new Date(from);
    results.length < maxCount && iterations < MAX_DAY_ITERATIONS;
    d.setDate(d.getDate() + 1), iterations++
  ) {
    if (d < startMidnight) continue;
    if (endDate && d > endDate) break;

    if (isEventOnDate(event, d)) {
      const occurrence = new Date(start);
      occurrence.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      results.push(occurrence);
    }
  }
  return results;
}

export function filterEventsByDateRange<T extends { start_datetime: string; is_recurring?: boolean; recurrence_pattern?: RecurrencePattern | null }>(
  events: T[],
  startDate: Date,
  endDate: Date
): T[] {
  const result: T[] = [];
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  for (const event of events) {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (isEventOnDate(event, d)) {
        result.push(event);
        break;
      }
    }
  }
  return result;
}
