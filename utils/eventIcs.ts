/**
 * Pure event-sharing helpers: web URLs, Google Calendar links, RRULE and ICS
 * generation. Kept free of React Native / Expo imports so it is unit-testable
 * under node (see vitest.config.mts) — the platform IO lives in eventShare.ts.
 */
import { normalizeWeekdays, weekOfMonthFor, type RecurrencePattern } from '@/utils/recurrence';
import { instantToPickerDate, isValidTimeZone, utcToWallClock, wallClockToUtc as wallClockToUtcLocal } from '@/utils/timezone';

/** "20261106T190000" — the wall clock of `iso` in `tz`, RFC 5545 local form. */
function formatIcsLocal(iso: string, tz: string): string {
  const w = utcToWallClock(new Date(iso), tz);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${w.year}${p(w.month)}${p(w.day)}T${p(w.hour)}${p(w.minute)}${p(w.second)}`;
}

/**
 * Universal links / web paths for sharing events (see app/event/[id].tsx).
 */
export function getEventWebUrl(eventId: string): string {
  const base = (process.env.EXPO_PUBLIC_APP_WEB_ORIGIN ?? 'https://eventmap.pro').replace(/\/$/, '');
  return `${base}/event/${eventId}`;
}
function padUtcGcal(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/** Opens Google Calendar “create event” with prefilled fields. */
export function getGoogleCalendarEventUrl(opts: {
  title: string;
  startIso: string;
  endIso: string;
  address?: string | null;
  details?: string;
  /** Emitted as the `recur` parameter so repeating events import as a series. */
  recurrence?: string | null;
  /** Event zone; Google shows the event in this zone (`ctz`) instead of the viewer's. */
  timezone?: string | null;
}): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${padUtcGcal(opts.startIso)}/${padUtcGcal(opts.endIso)}`,
  });
  if (opts.address) params.set('location', opts.address);
  if (opts.details) params.set('details', opts.details);
  if (opts.recurrence) params.set('recur', opts.recurrence);
  if (opts.timezone && isValidTimeZone(opts.timezone)) params.set('ctz', opts.timezone);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * RFC 5545 RRULE for an EventMap recurrence pattern, or null when the event
 * doesn't repeat. `endDate` (a local 'YYYY-MM-DD') becomes an inclusive
 * UNTIL at the end of that day, expressed in UTC as the spec requires.
 */
export function buildRecurrenceRule(
  pattern: RecurrencePattern | null | undefined,
  isRecurring?: boolean,
  /** Event zone: UNTIL becomes the end of that day in this zone (device zone when omitted). */
  timezone?: string | null,
  /** Series start (ISO); needed for monthly nth-weekday rules. */
  seriesStart?: string | null
): string | null {
  if (!isRecurring || !pattern) return null;
  const freq =
    pattern.frequency === 'daily'
      ? 'DAILY'
      : pattern.frequency === 'weekly'
        ? 'WEEKLY'
        : pattern.frequency === 'monthly'
          ? 'MONTHLY'
          : null;
  if (!freq) return null;

  const parts = [`FREQ=${freq}`];
  const interval = Number(pattern.interval);
  if (Number.isFinite(interval) && interval > 1) parts.push(`INTERVAL=${Math.floor(interval)}`);

  // Weekly on several days / monthly "2nd Tuesday" (RFC 5545 BYDAY). The
  // monthly weekday comes from DTSTART, so it needs the series start.
  const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  if (pattern.frequency === 'weekly') {
    const days = normalizeWeekdays(pattern.byWeekday);
    if (days) {
      parts.push(`BYDAY=${days.map((d) => ICS_DAYS[d]).join(',')}`);
      // Week numbering must match utils/recurrence (Monday-based weeks;
      // MO is also the RFC 5545 default, stated for clarity).
      if (Number.isFinite(interval) && interval > 1) parts.push('WKST=MO');
    }
  } else if (pattern.frequency === 'monthly' && pattern.monthly === 'nthWeekday' && seriesStart) {
    const start = timezone && isValidTimeZone(timezone) ? instantToPickerDate(new Date(seriesStart), timezone) : new Date(seriesStart);
    if (!Number.isNaN(start.getTime())) {
      const week = weekOfMonthFor(start);
      parts.push(`BYDAY=${week}${ICS_DAYS[start.getDay()]}`);
    }
  }

  const endDate = pattern.endDate;
  if (endDate && /^\d{4}-\d{2}-\d{2}/.test(endDate)) {
    const [y, m, d] = endDate.slice(0, 10).split('-').map(Number);
    if (timezone && isValidTimeZone(timezone)) {
      // With a TZID DTSTART the RRULE is evaluated in that zone, and UNTIL
      // must still be UTC: end of the final day in the event zone.
      const untilUtc = wallClockToUtcLocal({ year: y, month: m, day: d, hour: 23, minute: 59, second: 59 }, timezone);
      parts.push(`UNTIL=${padUtcGcal(untilUtc.toISOString())}`);
    } else {
      // Inclusive final day, in local time, then normalised to UTC.
      const until = new Date(y, m - 1, d, 23, 59, 59, 0);
      if (!Number.isNaN(until.getTime())) {
        parts.push(`UNTIL=${padUtcGcal(until.toISOString())}`);
      }
    }
  }
  return `RRULE:${parts.join(';')}`;
}

export type IcsEventInput = {
  /** Event id — used for the UID and the file name. */
  id: string;
  title: string;
  startIso: string;
  endIso: string;
  address?: string | null;
  description?: string;
  /** Full RRULE line (see buildRecurrenceRule); omitted for one-off events. */
  recurrence?: string | null;
  /**
   * Event zone. When set, DTSTART/DTEND are written as local wall clock with
   * TZID so calendar apps keep "7 pm Lisbon" as 7 pm and apply the zone's DST
   * rules to the series. Without it, times are UTC instants (legacy events).
   */
  timezone?: string | null;
  /**
   * Per-date changes of a series (utils/occurrences). Cancelled dates become
   * EXDATE; moved dates become EXDATE-free overrides: a second VEVENT with
   * the same UID and RECURRENCE-ID = the original start.
   */
  exceptions?: readonly {
    originalStartIso: string;
    kind: 'cancelled' | 'rescheduled';
    newStartIso?: string | null;
    newEndIso?: string | null;
  }[];
};

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newlines. */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** UTF-8 octet count for a code point (RFC 3629). */
function utf8Octets(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * RFC 5545 content lines must stay within 75 octets (not UTF-16 units);
 * continuation lines start with a space that counts toward the limit.
 * Folds between code points only — slicing by code units could split a
 * surrogate pair, which encodes to invalid UTF-8 in the written file.
 */
function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const chOctets = utf8Octets(ch.codePointAt(0) ?? 0);
    if (octets + chOctets > 75) {
      parts.push(current);
      current = ' ';
      octets = 1;
    }
    current += ch;
    octets += chOctets;
  }
  if (current.length > 0 || parts.length === 0) parts.push(current);
  return parts.join('\r\n');
}

const ICS_HEADER = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//EventMap//EventMap//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
];

/** The VEVENT block for one event (unfolded lines). Throws on an invalid start. */
function buildVEventLines(input: IcsEventInput, stamp: string): string[] {
  const start = new Date(input.startIso);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Invalid event start date');
  }
  let end = new Date(input.endIso);
  if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }
  const lines = ['BEGIN:VEVENT', `UID:event-${input.id}@eventmap.pro`, `DTSTAMP:${stamp}`];
  const tz = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : null;
  if (tz) {
    lines.push(
      `DTSTART;TZID=${tz}:${formatIcsLocal(start.toISOString(), tz)}`,
      `DTEND;TZID=${tz}:${formatIcsLocal(end.toISOString(), tz)}`
    );
  } else {
    lines.push(`DTSTART:${padUtcGcal(start.toISOString())}`, `DTEND:${padUtcGcal(end.toISOString())}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(input.title)}`);
  const at = (iso: string, prop: string) =>
    tz ? `${prop};TZID=${tz}:${formatIcsLocal(iso, tz)}` : `${prop}:${padUtcGcal(iso)}`;
  const valid = (iso: string | null | undefined): iso is string => !!iso && !Number.isNaN(new Date(iso).getTime());
  if (input.recurrence) {
    lines.push(input.recurrence);
    for (const x of input.exceptions ?? []) {
      if (x.kind === 'cancelled' && valid(x.originalStartIso)) lines.push(at(x.originalStartIso, 'EXDATE'));
    }
  }
  const tail: string[] = [];
  if (input.description) tail.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  if (input.address) tail.push(`LOCATION:${escapeIcsText(input.address)}`);
  tail.push(`URL:${getEventWebUrl(input.id)}`);
  lines.push(...tail, 'END:VEVENT');

  if (input.recurrence) {
    for (const x of input.exceptions ?? []) {
      if (x.kind !== 'rescheduled' || !valid(x.originalStartIso) || !valid(x.newStartIso) || !valid(x.newEndIso)) continue;
      lines.push(
        'BEGIN:VEVENT',
        `UID:event-${input.id}@eventmap.pro`,
        `DTSTAMP:${stamp}`,
        at(x.originalStartIso, 'RECURRENCE-ID'),
        at(x.newStartIso, 'DTSTART'),
        at(x.newEndIso, 'DTEND'),
        `SUMMARY:${escapeIcsText(input.title)}`,
        ...tail,
        'END:VEVENT'
      );
    }
  }
  return lines;
}

/**
 * Minimal valid single-event ICS. With a zone, dates are local + TZID (Apple,
 * Google and Outlook resolve IANA TZIDs without a VTIMEZONE block); otherwise
 * UTC basic format (YYYYMMDDTHHMMSSZ). An invalid/missing end falls back to
 * start + 1 hour.
 */
export function buildEventIcs(input: IcsEventInput): string {
  return buildCalendarIcs([input]);
}

/**
 * One VCALENDAR holding several VEVENTs (the personal calendar export). Each
 * event follows the same rules as `buildEventIcs`; an empty list still yields
 * a valid, empty calendar.
 */
export function buildCalendarIcs(inputs: readonly IcsEventInput[]): string {
  const stamp = padUtcGcal(new Date().toISOString());
  const lines = [...ICS_HEADER];
  for (const input of inputs) lines.push(...buildVEventLines(input, stamp));
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
