/**
 * One place for "when / how far" formatting across event cards and rows.
 *
 * Before this, Discover, Profile, UserProfile, BusinessDetail, Joined, Saved
 * and EventListItem each had their own formatter — four different shapes,
 * some hard-coded to `en-US`, distance always in miles. Everything here
 * follows the device locale; the only product decision baked in is the
 * Today / Tomorrow shorthand.
 *
 * Pure module (no React Native imports) so it is unit-tested under node.
 */

const toDate = (value: string | Date): Date | null => {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "Wed, May 13, 7:30 PM" — year only when it differs from the current one. */
export function formatEventDate(value: string | Date, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "7:30 PM" in the device locale. */
export function formatEventTime(value: string | Date): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Today" / "Tomorrow" / "Wed, May 13" (year added when it differs). */
export function formatEventDayLabel(value: string | Date, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '';
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/** "Today · 7:30 PM" — the compact card line. */
export function formatEventWhen(value: string | Date, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '';
  return `${formatEventDayLabel(d, now)} · ${formatEventTime(d)}`;
}

/** Regions that still measure road distance in miles. */
const MILE_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

/**
 * Whether to show miles for the given locale (device locale by default).
 * Exposed for tests; callers normally use formatDistance.
 */
export function usesMiles(locale?: string): boolean {
  try {
    const tag = locale ?? Intl.DateTimeFormat().resolvedOptions().locale;
    // Hermes has shipped without Intl.Locale; fall back to parsing the tag so
    // US devices don't silently flip to kilometres.
    const region =
      typeof Intl.Locale === 'function'
        ? new Intl.Locale(tag).region
        : tag.split(/[-_]/)[1];
    return region ? MILE_REGIONS.has(region.toUpperCase()) : false;
  } catch {
    const region = (locale ?? '').split(/[-_]/)[1];
    return region ? MILE_REGIONS.has(region.toUpperCase()) : false;
  }
}

/** "0.4 mi" / "2.3 km" / "350 m", following the device region. */
export function formatDistance(km: number, locale?: string): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (usesMiles(locale)) {
    const mi = km * 0.621371;
    if (mi < 0.1) return 'nearby';
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (km < 1) return `${Math.max(50, Math.round(km * 1000 / 50) * 50)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * Short name of the device's timezone ("PDT", "GMT+2"), or '' if the runtime
 * can't report one. Event times are stored as instants and rendered in the
 * device zone, so forms and detail pages label which zone that is — a host
 * entering times while travelling otherwise has no clue.
 */
export function timeZoneLabel(date: Date = new Date(), locale?: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' }).formatToParts(date);
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}
