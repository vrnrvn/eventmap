/**
 * Time-zone helpers for events (plan §4D). Pure module — no React Native
 * imports — unit-tested under node (tests/timezone.test.ts).
 *
 * Model: an event stores an instant (`timestamptz`) plus an IANA zone
 * (`events.timezone`, 20261103140000). The zone says which wall clock the
 * host meant, so a 7 pm show in Lisbon stays "7 pm" on the detail page for a
 * viewer in New York, with "2 pm your time" underneath. Events created before
 * the column existed have `timezone = null` and keep today's behaviour
 * (rendered in the viewer's zone, no second line).
 *
 * Everything is built on `Intl.DateTimeFormat` with the `timeZone` option,
 * which Hermes ships; there is no tz database in the bundle.
 */

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
};

const FALLBACK_ZONE = 'UTC';

/** The device's IANA zone, or 'UTC' if the runtime can't say. */
export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_ZONE;
  } catch {
    return FALLBACK_ZONE;
  }
}

/** Whether Intl accepts `tz` as a zone id. Accepts 'UTC'; rejects '', junk, offsets like '+02:00'. */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== 'string') return false;
  // Newer ICU accepts "+02:00"-style offset zones; we only store named zones
  // (they carry DST rules, offsets don't). 'UTC' is the single slash-less id.
  if (tz !== 'UTC' && !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A reasonable list when `Intl.supportedValuesOf` is missing (older Hermes).
 * One or two zones per populous region; the picker's search also accepts any
 * valid id typed in full.
 */
const FALLBACK_ZONES = [
  'UTC',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris',
  'Europe/Brussels', 'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Zurich', 'Europe/Rome',
  'Europe/Vienna', 'Europe/Prague', 'Europe/Warsaw', 'Europe/Stockholm', 'Europe/Oslo',
  'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Kyiv',
  'Europe/Moscow',
  'America/New_York', 'America/Toronto', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Vancouver', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Santiago',
  'America/Buenos_Aires', 'America/Sao_Paulo', 'America/Halifax', 'America/St_Johns',
  'Africa/Casablanca', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Nairobi',
  'Asia/Dubai', 'Asia/Tehran', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok',
  'Asia/Jakarta', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Manila',
  'Asia/Seoul', 'Asia/Tokyo',
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Sydney',
  'Pacific/Auckland',
];

/** Every zone id the runtime knows, sorted; falls back to a curated list. */
export function listTimeZones(): string[] {
  const intlWithValues = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    if (typeof intlWithValues.supportedValuesOf === 'function') {
      const zones = intlWithValues.supportedValuesOf('timeZone');
      if (Array.isArray(zones) && zones.length > 0) {
        return zones.includes('UTC') ? zones : ['UTC', ...zones];
      }
    }
  } catch {
    // fall through
  }
  return FALLBACK_ZONES;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatterCache.set(tz, f);
  }
  return f;
}

/** Wall-clock reading of `date` in `tz`. */
export function utcToWallClock(date: Date, tz: string): WallClock {
  const parts = partsFormatter(tz).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Some engines report midnight as "24" with hourCycle h23 quirks; normalise.
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `tz` from UTC at `date`, in minutes (east positive, like +60 for CET). */
export function getZoneOffsetMinutes(date: Date, tz: string): number {
  const w = utcToWallClock(date, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Instant for a wall-clock time in `tz`. Resolves DST edges the way
 * calendars do: a time inside a spring-forward gap maps to the instant after
 * the gap; an ambiguous fall-back time takes the first (DST) occurrence.
 */
export function wallClockToUtc(w: WallClock, tz: string): Date {
  const naive = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second ?? 0);
  // First guess: subtract the offset that applies at the naive instant, then
  // correct once using the offset at the guess (handles transitions).
  let guess = naive - getZoneOffsetMinutes(new Date(naive), tz) * 60000;
  const offsetAtGuess = getZoneOffsetMinutes(new Date(guess), tz);
  const corrected = naive - offsetAtGuess * 60000;
  if (corrected !== guess) {
    // Check both candidates; prefer the one that round-trips to the asked wall time.
    const back = utcToWallClock(new Date(corrected), tz);
    if (back.hour === w.hour && back.minute === w.minute && back.day === w.day) {
      guess = corrected;
    } else {
      // Inside a spring-forward gap: neither candidate round-trips. Calendars
      // resolve a nonexistent time forward (02:30 -> 03:30 EDT), which is the
      // LATER instant of the two candidates.
      guess = Math.max(guess, corrected);
    }
  }
  return new Date(guess);
}

/**
 * A Date whose *local* components equal the wall clock of `date` in `tz`.
 * This is what native date pickers want: they edit local components. Pair
 * with `pickerDateToInstant` on the way back.
 */
export function instantToPickerDate(date: Date, tz: string): Date {
  const w = utcToWallClock(date, tz);
  return new Date(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, 0);
}

/** Inverse of `instantToPickerDate`: read local components as wall clock in `tz`. */
export function pickerDateToInstant(picker: Date, tz: string): Date {
  return wallClockToUtc(
    {
      year: picker.getFullYear(),
      month: picker.getMonth() + 1,
      day: picker.getDate(),
      hour: picker.getHours(),
      minute: picker.getMinutes(),
      second: picker.getSeconds(),
    },
    tz
  );
}

/** 'YYYY-MM-DD' of `date` as seen in `tz`. */
export function dateKeyInZone(date: Date, tz: string): string {
  const w = utcToWallClock(date, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Short zone name at `date` ("PST", "GMT+1", "WET"), or the id on failure. */
export function zoneAbbreviation(tz: string, date: Date = new Date(), locale?: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}

/** "GMT+1" / "GMT-7:30" style offset label. */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'GMT';
  const sign = minutes > 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** "Lisbon" from "Europe/Lisbon"; "New York" from "America/New_York"; "UTC" stays. */
export function zoneCityName(tz: string): string {
  const last = tz.split('/').pop() ?? tz;
  return last.replace(/_/g, ' ');
}

/** "Lisbon (GMT+1)" — for pickers and the form row. */
export function zoneDisplayLabel(tz: string, date: Date = new Date()): string {
  if (!isValidTimeZone(tz)) return tz;
  if (tz === 'UTC') return 'UTC';
  return `${zoneCityName(tz)} (${formatOffset(getZoneOffsetMinutes(date, tz))})`;
}

export type TimeZoneOption = { id: string; label: string; region: string; offsetMinutes: number };

/** Picker rows: id, "City (GMT+x)", region ("Europe"), offset for sorting. */
export function timeZoneOptions(date: Date = new Date(), zones: string[] = listTimeZones()): TimeZoneOption[] {
  const out: TimeZoneOption[] = [];
  for (const id of zones) {
    if (!isValidTimeZone(id)) continue;
    const offsetMinutes = getZoneOffsetMinutes(date, id);
    out.push({
      id,
      label: id === 'UTC' ? 'UTC' : `${zoneCityName(id)} (${formatOffset(offsetMinutes)})`,
      region: id.includes('/') ? id.split('/')[0] : 'Other',
      offsetMinutes,
    });
  }
  return out.sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.id.localeCompare(b.id));
}

/** Case-insensitive match on id, city, region or offset label. */
export function searchTimeZones(options: TimeZoneOption[], query: string): TimeZoneOption[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return options;
  const qUnderscore = q.replace(/ /g, '_');
  return options.filter(
    (o) =>
      o.id.toLowerCase().includes(qUnderscore) ||
      o.label.toLowerCase().includes(q) ||
      o.region.toLowerCase().includes(q)
  );
}

/** Locale-formatted date/time of an instant as seen in `tz`. */
export function formatInZone(
  date: Date,
  tz: string,
  options: Intl.DateTimeFormatOptions,
  locale?: string
): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: tz }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}

export type EventWhenDisplay = {
  /** Time in the event's zone, e.g. "7:00 PM" plus zone abbreviation when it differs from the viewer. */
  primary: string;
  /** Viewer's local reading when zones differ at that instant, e.g. "4:00 AM your time (Nov 6)". */
  secondary: string | null;
  /** Whether the viewer's zone shows a different wall clock. */
  differs: boolean;
};

/**
 * The display rule for one instant. `eventTz` null → legacy event, rendered
 * in the viewer zone with no second line.
 */
export function describeEventTime(
  value: string | Date,
  eventTz: string | null | undefined,
  viewerTz: string = getDeviceTimeZone(),
  locale?: string
): EventWhenDisplay {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return { primary: '', secondary: null, differs: false };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

  if (!eventTz || !isValidTimeZone(eventTz)) {
    return { primary: formatInZone(date, viewerTz, timeOpts, locale), secondary: null, differs: false };
  }

  const eventOffset = getZoneOffsetMinutes(date, eventTz);
  const viewerOffset = getZoneOffsetMinutes(date, viewerTz);
  const differs = eventOffset !== viewerOffset;
  const primaryTime = formatInZone(date, eventTz, timeOpts, locale);
  if (!differs) return { primary: primaryTime, secondary: null, differs: false };

  const primary = `${primaryTime} ${zoneAbbreviation(eventTz, date, locale)}`;
  const viewerTime = formatInZone(date, viewerTz, timeOpts, locale);
  const sameDay = dateKeyInZone(date, eventTz) === dateKeyInZone(date, viewerTz);
  const dayNote = sameDay
    ? ''
    : ` (${formatInZone(date, viewerTz, { month: 'short', day: 'numeric' }, locale)})`;
  return { primary, secondary: `${viewerTime} your time${dayNote}`, differs: true };
}

export type EventDateTimeDisplay = {
  /** "Fri, Nov 6, 7:00 PM" in the event zone, with the zone abbreviation when the viewer's clock differs. */
  primary: string;
  /** "2:00 PM your time (Nov 6)" when the viewer's clock differs; otherwise null. */
  secondary: string | null;
};

/**
 * Date + time line for list rows (Saved, Joined): same rule as
 * `describeEventTime`, with the date included. Legacy events (no zone)
 * render in the viewer's zone with no second line.
 */
export function describeEventDateTime(
  value: string | Date,
  eventTz: string | null | undefined,
  viewerTz: string = getDeviceTimeZone(),
  locale?: string,
  now: Date = new Date()
): EventDateTimeDisplay {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return { primary: '', secondary: null };
  const zone = eventTz && isValidTimeZone(eventTz) ? eventTz : viewerTz;
  const sameYear = dateKeyInZone(date, zone).slice(0, 4) === dateKeyInZone(now, zone).slice(0, 4);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  const when = describeEventTime(date, eventTz, viewerTz, locale);
  const base = formatInZone(date, zone, opts, locale);
  return when.differs
    ? { primary: `${base} ${zoneAbbreviation(zone, date, locale)}`, secondary: when.secondary }
    : { primary: base, secondary: null };
}
