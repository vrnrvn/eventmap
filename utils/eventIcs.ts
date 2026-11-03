/**
 * Pure event-sharing helpers: web URLs, Google Calendar links, RRULE and ICS
 * generation. Kept free of React Native / Expo imports so it is unit-testable
 * under node (see vitest.config.mts) — the platform IO lives in eventShare.ts.
 */
import type { RecurrencePattern } from '@/utils/recurrence';

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
}): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${padUtcGcal(opts.startIso)}/${padUtcGcal(opts.endIso)}`,
  });
  if (opts.address) params.set('location', opts.address);
  if (opts.details) params.set('details', opts.details);
  if (opts.recurrence) params.set('recur', opts.recurrence);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * RFC 5545 RRULE for an EventMap recurrence pattern, or null when the event
 * doesn't repeat. `endDate` (a local 'YYYY-MM-DD') becomes an inclusive
 * UNTIL at the end of that day, expressed in UTC as the spec requires.
 */
export function buildRecurrenceRule(
  pattern: RecurrencePattern | null | undefined,
  isRecurring?: boolean
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

  const endDate = pattern.endDate;
  if (endDate && /^\d{4}-\d{2}-\d{2}/.test(endDate)) {
    const [y, m, d] = endDate.slice(0, 10).split('-').map(Number);
    // Inclusive final day, in local time, then normalised to UTC.
    const until = new Date(y, m - 1, d, 23, 59, 59, 0);
    if (!Number.isNaN(until.getTime())) {
      parts.push(`UNTIL=${padUtcGcal(until.toISOString())}`);
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

/**
 * Minimal valid single-event ICS. Dates are emitted in UTC basic format
 * (YYYYMMDDTHHMMSSZ); an invalid/missing end falls back to start + 1 hour.
 */
export function buildEventIcs(input: IcsEventInput): string {
  const start = new Date(input.startIso);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Invalid event start date');
  }
  let end = new Date(input.endIso);
  if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EventMap//EventMap//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:event-${input.id}@eventmap.pro`,
    `DTSTAMP:${padUtcGcal(new Date().toISOString())}`,
    `DTSTART:${padUtcGcal(start.toISOString())}`,
    `DTEND:${padUtcGcal(end.toISOString())}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
  ];
  if (input.recurrence) lines.push(input.recurrence);
  if (input.description) lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  if (input.address) lines.push(`LOCATION:${escapeIcsText(input.address)}`);
  lines.push(`URL:${getEventWebUrl(input.id)}`, 'END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
