import { Linking, Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

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
}): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${padUtcGcal(opts.startIso)}/${padUtcGcal(opts.endIso)}`,
  });
  if (opts.address) params.set('location', opts.address);
  if (opts.details) params.set('details', opts.details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export type IcsEventInput = {
  /** Event id — used for the UID and the file name. */
  id: string;
  title: string;
  startIso: string;
  endIso: string;
  address?: string | null;
  description?: string;
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
  if (input.description) lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  if (input.address) lines.push(`LOCATION:${escapeIcsText(input.address)}`);
  lines.push(`URL:${getEventWebUrl(input.id)}`, 'END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/**
 * Generates the .ics for an event and hands it to the platform:
 * - web: Blob download (data stays on-page, no server round trip);
 * - iOS: file written to the cache dir, shared via the native share sheet
 *   (Share.share supports file:// URLs on iOS — expo-sharing is not in deps);
 * - Android: RN's Share can only send text, so the cached file is exposed via
 *   a content:// URI (FileProvider) and opened with ACTION_VIEW, which lets
 *   the user's calendar app import it.
 *
 * Throws on failure (callers surface a toast); a dismissed share sheet resolves.
 */
export async function shareEventIcs(input: IcsEventInput): Promise<void> {
  const ics = buildEventIcs(input);
  const fileName = `event-${input.id}.ics`;

  if (Platform.OS === 'web') {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      // Give the download a tick to start before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    return;
  }

  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, ics, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (Platform.OS === 'ios') {
    await Share.share({ title: input.title, url: fileUri });
    return;
  }

  // Android
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await Linking.openURL(contentUri);
}
