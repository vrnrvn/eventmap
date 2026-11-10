import { instantToPickerDate, isValidTimeZone, pickerDateToInstant } from '@/utils/timezone';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

/**
 * Stored in `events.recurrence_pattern` (jsonb). Every key added after the
 * original `{frequency, interval, endDate}` is optional, and a pattern
 * without them behaves exactly as before (docs/CATEGORIES_AND_SERIES_PLAN.md
 * §4.2). The SQL `event_next_occurrence` mirrors these rules
 * (20261109130000_recurrence_patterns_v2.sql).
 */
export type RecurrencePattern = {
  frequency: RecurrenceFrequency;
  interval: number;
  endDate?: string;
  /**
   * Weekly only: days of the week the series runs on, 0 = Sunday … 6 =
   * Saturday. Missing/empty = the start date's weekday. `interval` counts
   * Monday-based weeks from the start's week (matches the server).
   */
  byWeekday?: number[];
  /**
   * Monthly only. 'dayOfMonth' (default, original behaviour) = same date each
   * month, clamped to short months. 'nthWeekday' = the start's weekday in
   * the start's week of the month ("2nd Tuesday"), or the last such weekday
   * when the start is in the month's final seven days ("last Friday").
   */
  monthly?: 'dayOfMonth' | 'nthWeekday';
};

export type RecurrenceOption = RecurrencePattern | null;

export const RECURRENCE_OPTIONS: { value: RecurrenceOption; label: string }[] = [
  { value: null, label: 'None' },
  { value: { frequency: 'daily', interval: 1 }, label: 'Every Day' },
  { value: { frequency: 'weekly', interval: 1 }, label: 'Every Week' },
  { value: { frequency: 'monthly', interval: 1 }, label: 'Every Month' },
];

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDINALS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' };

/** Sorted, de-duplicated weekdays in 0–6, or null when unset/invalid. */
export function normalizeWeekdays(days: readonly unknown[] | null | undefined): number[] | null {
  if (!Array.isArray(days)) return null;
  const set = new Set<number>();
  for (const d of days) {
    const n = Number(d);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  return set.size ? [...set].sort((a, b) => a - b) : null;
}

/**
 * Which weekday-of-month a series start implies for 'nthWeekday': -1 (last)
 * when the start is in the final seven days of its month, else 1–4. Same
 * rule as the server, so "the 4th Friday" that is also the last one means
 * "last Friday".
 */
export function weekOfMonthFor(d: Date): 1 | 2 | 3 | 4 | -1 {
  if (isLastWeekdayOfMonth(d)) return -1;
  return Math.ceil(d.getDate() / 7) as 1 | 2 | 3 | 4;
}

/** Whether `d` is in the last seven days of its month (its weekday can't recur later that month). */
export function isLastWeekdayOfMonth(d: Date): boolean {
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() + 7 > daysInMonth;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Plain-language summary of a pattern, e.g. "Every Tuesday and Thursday",
 * "Every 2 weeks on Saturday", "Monthly on the second Tuesday", "Every
 * weekday". `start` supplies the implied weekday/date; `withEnd` appends
 * "until 3 Mar 2027" when an end date is set.
 */
export function describeRecurrence(
  pattern: RecurrencePattern | null | undefined,
  start?: Date | string | null,
  opts: { withEnd?: boolean } = {}
): string {
  if (!pattern) return '';
  const startDate = start ? new Date(start) : null;
  const validStart = startDate && !Number.isNaN(startDate.getTime()) ? startDate : null;
  const n = Math.max(1, Math.floor(Number(pattern.interval) || 1));
  let text: string;

  switch (pattern.frequency) {
    case 'daily':
      text = n === 1 ? 'Every day' : `Every ${n} days`;
      break;
    case 'weekly': {
      const days = normalizeWeekdays(pattern.byWeekday) ?? (validStart ? [validStart.getDay()] : null);
      const key = days?.join(',');
      const named =
        key === '1,2,3,4,5' ? 'weekday' : key === '0,6' ? 'weekend day' : null;
      if (named && n === 1) {
        text = `Every ${named}`;
      } else if (!days) {
        text = n === 1 ? 'Every week' : `Every ${n} weeks`;
      } else {
        const list = days.length > 3 ? days.map((d) => WEEKDAY_SHORT[d]).join(', ') : joinList(days.map((d) => WEEKDAY_NAMES[d]));
        text = n === 1 ? `Every ${list}` : `Every ${n} weeks on ${list}`;
      }
      break;
    }
    case 'monthly': {
      const every = n === 1 ? 'Monthly' : `Every ${n} months`;
      if (pattern.monthly === 'nthWeekday' && validStart) {
        const ord = ORDINALS[weekOfMonthFor(validStart)] ?? 'first';
        text = `${every} on the ${ord} ${WEEKDAY_NAMES[validStart.getDay()]}`;
      } else if (validStart) {
        text = `${every} on day ${validStart.getDate()}`;
      } else {
        text = n === 1 ? 'Every month' : `Every ${n} months`;
      }
      break;
    }
    default:
      text = 'Repeats';
  }

  if (opts.withEnd) {
    const end = parseRecurrenceEndDate(pattern.endDate);
    if (end) {
      text += ` · until ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
  }
  return text;
}

/** Short label (no start context); kept for callers that only have the pattern. */
export function getRecurrenceLabel(pattern: RecurrencePattern | null | undefined): string {
  if (!pattern) return '';
  const opt = RECURRENCE_OPTIONS.find(
    (o) =>
      o.value &&
      o.value.frequency === pattern.frequency &&
      o.value.interval === pattern.interval &&
      !normalizeWeekdays(pattern.byWeekday) &&
      pattern.monthly !== 'nthWeekday'
  );
  return opt?.label ?? describeRecurrence(pattern);
}

/**
 * Problems with a pattern a host built, or null when it is usable. Mirrors
 * the server's `recurrence_pattern` validation trigger.
 */
export function validateRecurrencePattern(p: RecurrencePattern): string | null {
  if (!['daily', 'weekly', 'monthly'].includes(p.frequency)) return 'Pick how often it repeats';
  const n = Number(p.interval);
  if (!Number.isInteger(n) || n < 1 || n > 99) return 'Repeat every 1–99';
  if (p.byWeekday !== undefined) {
    if (p.frequency !== 'weekly') return 'Weekdays only apply to weekly repeats';
    if (!normalizeWeekdays(p.byWeekday)) return 'Pick at least one day';
  }
  if (p.monthly !== undefined) {
    if (p.frequency !== 'monthly') return 'Monthly options only apply to monthly repeats';
    if (p.monthly !== 'dayOfMonth' && p.monthly !== 'nthWeekday') return 'Pick which day of the month';
  }
  return null;
}

/**
 * "Ends after N times" → the `endDate` of the Nth occurrence, so storage
 * stays a single end date. Null when the pattern produces fewer than N dates
 * within the walk limit.
 */
export function endDateAfterCount(
  event: { start_datetime: string; recurrence_pattern: RecurrencePattern; timezone?: string | null },
  count: number
): string | null {
  const target = Math.floor(count);
  if (!Number.isFinite(target) || target < 1) return null;
  const pattern = { ...event.recurrence_pattern };
  delete pattern.endDate;
  const start = new Date(event.start_datetime);
  // Walk from the series start, not from today.
  const dates = getNextOccurrences(
    { ...event, is_recurring: true, recurrence_pattern: pattern },
    target,
    new Date(start.getFullYear(), start.getMonth(), start.getDate())
  );
  if (dates.length < target) return null;
  const last = dates[target - 1];
  const zone = event.timezone && isValidTimeZone(event.timezone) ? event.timezone : null;
  return toRecurrenceEndDate(zone ? instantToPickerDate(last, zone) : last);
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
    case 'weekly': {
      const days = normalizeWeekdays(pattern.byWeekday);
      if (!days) {
        return sameDayOfWeek(start, checkDate) && Math.floor(diffDays / 7) % pattern.interval === 0;
      }
      if (!days.includes(checkDate.getDay())) return false;
      // Weeks run Monday–Sunday from the start's week (as on the server), so
      // "every 2 weeks on Tue and Thu" keeps both days in the same active week.
      const mondayOf = (d: Date) => {
        const m = new Date(d);
        m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
        return m.getTime();
      };
      const weekDiff = Math.round((mondayOf(checkDate) - mondayOf(checkStart)) / (7 * 24 * 60 * 60 * 1000));
      return weekDiff % pattern.interval === 0;
    }
    case 'monthly': {
      // Honor `interval` via whole-month arithmetic (year*12 + month), since a
      // day-diff can't express "every N months".
      const monthsDiff =
        (checkDate.getFullYear() - checkStart.getFullYear()) * 12 +
        (checkDate.getMonth() - checkStart.getMonth());
      if (monthsDiff % pattern.interval !== 0) return false;
      if (pattern.monthly === 'nthWeekday') {
        if (checkDate.getDay() !== checkStart.getDay()) return false;
        const week = weekOfMonthFor(checkStart);
        return week === -1 ? isLastWeekdayOfMonth(checkDate) : Math.ceil(checkDate.getDate() / 7) === week;
      }
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

/**
 * One or two words for a card badge: "Daily", "Weekly", "Every 2 weeks",
 * "Weekdays", "Monthly". Longer detail belongs to describeRecurrence.
 */
export function cadenceLabel(pattern: RecurrencePattern | null | undefined): string {
  if (!pattern) return '';
  const n = Math.max(1, Math.floor(Number(pattern.interval) || 1));
  switch (pattern.frequency) {
    case 'daily':
      return n === 1 ? 'Daily' : `Every ${n} days`;
    case 'weekly': {
      const key = normalizeWeekdays(pattern.byWeekday)?.join(',');
      if (n === 1 && key === '1,2,3,4,5') return 'Weekdays';
      if (n === 1 && key === '0,6') return 'Weekends';
      return n === 1 ? 'Weekly' : n === 2 ? 'Every 2 weeks' : `Every ${n} weeks`;
    }
    case 'monthly':
      return n === 1 ? 'Monthly' : `Every ${n} months`;
    default:
      return 'Repeats';
  }
}
