/**
 * Pure helpers for the personal events calendar (docs/ANALYTICS_AND_CALENDAR_PLAN.md
 * Part 2). No React Native imports so everything is unit-tested under node.
 *
 * Model: the lists the app already has (going / interested / saved / hosting)
 * return one row per event *series*. The calendar expands those rows into
 * dated occurrences for the visible range and groups them by the viewer's
 * calendar day. Recurrence expansion reuses `getNextOccurrences`, so the
 * calendar and the Discover / Joined screens agree on which dates a series
 * falls on (including the event-zone DST handling added in Phase 2).
 */
import { getNextOccurrences, type RecurrencePattern } from '@/utils/recurrence';
import { occurrenceDateKey, type OccurrenceException } from '@/utils/occurrences';
import {
  dateKeyInZone,
  describeEventTime,
  formatInZone,
  getDeviceTimeZone,
  isValidTimeZone,
  wallClockToUtc,
  zoneAbbreviation,
} from '@/utils/timezone';
import { hasEventEnded } from '@/utils/eventStatus';
import { buildRecurrenceRule, type IcsEventInput } from '@/utils/eventIcs';

/** 'collections' = any event in one of the viewer's collections (20261112100000). */
export type CalendarSource = 'going' | 'interested' | 'saved' | 'hosting' | 'collections';

/** Display priority when one event is in several lists. */
export const SOURCE_PRIORITY: readonly CalendarSource[] = ['going', 'hosting', 'interested', 'saved', 'collections'];

export const ALL_SOURCES: readonly CalendarSource[] = ['going', 'interested', 'saved', 'collections', 'hosting'];

/** The fields the calendar needs from a list row. RankedEvent and Event both satisfy it. */
export type CalendarEvent = {
  id: string;
  title: string;
  start_datetime: string;
  end_datetime: string;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  timezone?: string | null;
  status?: string;
  address?: string;
  description?: string;
  cover_image_url?: string | null;
  business_name?: string;
};

export type SourcedEvent<T extends CalendarEvent = CalendarEvent> = {
  event: T;
  source: CalendarSource;
  /** RSVP waiting for host approval (rendered inside Going with a Pending badge). */
  pending?: boolean;
};

export type Occurrence<T extends CalendarEvent = CalendarEvent> = {
  /** `${event.id}:${dayKey}` — stable across re-renders and unique per day. */
  key: string;
  /** `${event.id}@${start ISO}` — shared by every day segment of one multi-day occurrence. */
  occurrenceId: string;
  event: T;
  /** Every list the event appears in, in SOURCE_PRIORITY order. */
  sources: CalendarSource[];
  /** The caller asked to join and the host hasn't approved yet. */
  pending: boolean;
  start: Date;
  end: Date;
  /** 'YYYY-MM-DD' in the viewer's zone: the day this segment is listed on. */
  dayKey: string;
  /** 0-based day of a multi-day occurrence; 0 for single-day ones. */
  spanIndex: number;
  /** Number of days the occurrence is listed on (1 for single-day ones). */
  spanDays: number;
  isSeries: boolean;
};

/** Inclusive range of calendar days, given as instants (any time on those days). */
export type DayRange = { from: Date; to: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' from calendar components (month is 0-based like Date). */
export function dayKeyOf(year: number, month0: number, day: number): string {
  return `${year}-${pad(month0 + 1)}-${pad(day)}`;
}

/** Parse a day key into its components; null for junk. */
export function parseDayKey(key: string): { year: number; month0: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), month0: Number(m[2]) - 1, day: Number(m[3]) };
}

/** Day key of an instant as seen in `tz` (device zone by default). */
export function dayKeyInViewerZone(date: Date, tz: string = getDeviceTimeZone()): string {
  return dateKeyInZone(date, isValidTimeZone(tz) ? tz : 'UTC');
}

/** Primary source for colouring a marker or badge. */
export function primarySource(occ: Pick<Occurrence, 'sources'>): CalendarSource {
  return occ.sources[0] ?? 'saved';
}

export function isCancelled(event: Pick<CalendarEvent, 'status'>): boolean {
  return event.status === 'cancelled';
}

function sortSources(sources: Iterable<CalendarSource>): CalendarSource[] {
  const set = new Set(sources);
  return SOURCE_PRIORITY.filter((s) => set.has(s));
}

/** Whole days between two day keys (b - a), using UTC arithmetic so DST can't skew it. */
export function daysBetween(a: string, b: string): number {
  const pa = parseDayKey(a);
  const pb = parseDayKey(b);
  if (!pa || !pb) return 0;
  return Math.round((Date.UTC(pb.year, pb.month0, pb.day) - Date.UTC(pa.year, pa.month0, pa.day)) / DAY_MS);
}

/** `key` moved by `n` days. */
export function addDaysToKey(key: string, n: number): string {
  const p = parseDayKey(key);
  if (!p) return key;
  const d = new Date(Date.UTC(p.year, p.month0, p.day + n));
  return dayKeyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Longest span a single occurrence is spread over; longer entries are almost certainly typos. */
export const MAX_SPAN_DAYS = 14;
/** A night out that ends before this hour the next morning stays on its start day. */
const OVERNIGHT_CUTOFF_MS = 6 * 60 * 60 * 1000;

/**
 * The days an occurrence is listed on, in `tz`. An event that ends exactly at
 * midnight doesn't spill onto the next day, and an evening event under 24 h
 * that ends before 06:00 the next morning (a party until 2 am) stays on its
 * start day. Capped at MAX_SPAN_DAYS.
 */
export function occurrenceDayKeys(start: Date, end: Date, tz: string): string[] {
  const startKey = dateKeyInZone(start, tz);
  const duration = end.getTime() - start.getTime();
  const lastInstant = duration < DAY_MS ? end.getTime() - OVERNIGHT_CUTOFF_MS - 1 : end.getTime() - 1;
  let endKey = dateKeyInZone(new Date(lastInstant), tz);
  if (endKey < startKey) endKey = startKey;
  const days = Math.min(daysBetween(startKey, endKey) + 1, MAX_SPAN_DAYS);
  return Array.from({ length: days }, (_, i) => addDaysToKey(startKey, i));
}

/**
 * Expand series rows into dated occurrences inside `range`, grouped so that
 * an event present in several sources yields one occurrence with every
 * source listed. Multi-day occurrences get one segment per day they cover
 * (see `occurrenceDayKeys`), including ones that started before the range.
 * Cancelled events are kept so the day list can show them with a badge;
 * callers filter for markers.
 */
export function expandOccurrences<T extends CalendarEvent>(
  rows: readonly SourcedEvent<T>[],
  range: DayRange,
  viewerTz: string = getDeviceTimeZone(),
  /**
   * Per-date exceptions by event id (services/occurrences). Skipped dates
   * are dropped; moved dates appear at their new time. A date moved INTO the
   * range from outside it is not picked up (the walk keys on original dates).
   */
  exceptionsByEvent?: ReadonlyMap<string, readonly OccurrenceException[]>
): Occurrence<T>[] {
  const tz = isValidTimeZone(viewerTz) ? viewerTz : 'UTC';
  const fromKey = dateKeyInZone(range.from, tz);
  const toKey = dateKeyInZone(range.to, tz);
  if (toKey < fromKey) return [];
  const rangeDays = daysBetween(fromKey, toKey) + 1;

  // Merge sources per event first so a series is expanded once.
  const byId = new Map<string, { event: T; sources: Set<CalendarSource>; pending: boolean }>();
  for (const row of rows) {
    const entry = byId.get(row.event.id);
    if (entry) {
      entry.sources.add(row.source);
      entry.pending = entry.pending || !!row.pending;
    } else {
      byId.set(row.event.id, { event: row.event, sources: new Set([row.source]), pending: !!row.pending });
    }
  }

  const out: Occurrence<T>[] = [];
  const push = (event: T, sources: CalendarSource[], pending: boolean, start: Date, end: Date, isSeries: boolean) => {
    const days = occurrenceDayKeys(start, end, tz);
    const occurrenceId = `${event.id}@${start.toISOString()}`;
    days.forEach((dayKey, spanIndex) => {
      if (dayKey < fromKey || dayKey > toKey) return;
      out.push({
        key: `${event.id}:${dayKey}`,
        occurrenceId,
        event,
        sources,
        pending,
        start,
        end,
        dayKey,
        spanIndex,
        spanDays: days.length,
        isSeries,
      });
    });
  };

  for (const { event, sources, pending } of byId.values()) {
    const start = new Date(event.start_datetime);
    if (Number.isNaN(start.getTime())) continue;
    let end = new Date(event.end_datetime);
    if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }
    const duration = end.getTime() - start.getTime();
    const sorted = sortSources(sources);

    if (!event.is_recurring || !event.recurrence_pattern) {
      push(event, sorted, pending, start, end, false);
      continue;
    }

    // Walk from the first day of the range, reaching back far enough to pick
    // up a multi-day occurrence that started before it. A daily series has at
    // most one occurrence per day, so the day count bounds the walk.
    const lookBack = Math.min(Math.ceil(duration / DAY_MS), MAX_SPAN_DAYS);
    const walkFrom = new Date(range.from.getTime() - lookBack * DAY_MS);
    const exByKey = new Map((exceptionsByEvent?.get(event.id) ?? []).map((x) => [x.occurrence_date.slice(0, 10), x]));
    // G15: a date moved INTO the range from outside it is not reached by the
    // walk over original dates, so add such moves directly.
    const walked = new Set<string>();
    for (const x of exByKey.values()) {
      if (x.kind !== 'rescheduled' || !x.new_start || !x.new_end) continue;
      const ns = new Date(x.new_start);
      const key = dateKeyInZone(ns, tz);
      if (key < fromKey || key > toKey) continue;
      const original = x.occurrence_date.slice(0, 10);
      // Only when the original date is outside what the walk below covers.
      if (original >= dateKeyInZone(walkFrom, tz) && original <= toKey) continue;
      push(event, sorted, pending, ns, new Date(x.new_end), true);
      walked.add(original);
    }
    for (const occStart of getNextOccurrences(event, rangeDays + lookBack, walkFrom)) {
      if (dateKeyInZone(occStart, tz) > toKey) break;
      const ex = exByKey.size ? exByKey.get(occurrenceDateKey(occStart, event.timezone)) : undefined;
      if (ex?.kind === 'cancelled') continue;
      if (ex?.kind === 'rescheduled' && ex.new_start && ex.new_end) {
        push(event, sorted, pending, new Date(ex.new_start), new Date(ex.new_end), true);
        continue;
      }
      push(event, sorted, pending, occStart, new Date(occStart.getTime() + duration), true);
    }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.event.title.localeCompare(b.event.title));
  return out;
}

/** Occurrences grouped by day key, each day sorted by start time. Only days with events appear. */
export function groupByDay<T extends CalendarEvent>(occurrences: readonly Occurrence<T>[]): Map<string, Occurrence<T>[]> {
  const map = new Map<string, Occurrence<T>[]>();
  for (const occ of occurrences) {
    const list = map.get(occ.dayKey);
    if (list) list.push(occ);
    else map.set(occ.dayKey, [occ]);
  }
  for (const list of map.values()) list.sort((a, b) => a.start.getTime() - b.start.getTime());
  return map;
}

/**
 * Occurrence ids (`occurrenceId`, shared by every day segment) that overlap
 * in time with another occurrence from a "committed" source (going /
 * hosting by default). Interested and saved events, pending requests and
 * cancelled events don't count: the user hasn't promised to be there.
 */
export function findOverlaps<T extends CalendarEvent>(
  occurrences: readonly Occurrence<T>[],
  committed: readonly CalendarSource[] = ['going', 'hosting']
): Set<string> {
  const committedSet = new Set(committed);
  const unique = new Map<string, Occurrence<T>>();
  for (const o of occurrences) {
    if (isCancelled(o.event) || o.pending || !o.sources.some((s) => committedSet.has(s))) continue;
    if (!unique.has(o.occurrenceId)) unique.set(o.occurrenceId, o);
  }
  const candidates = [...unique.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
  const result = new Set<string>();
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (b.start.getTime() >= a.end.getTime()) break;
      result.add(a.occurrenceId);
      result.add(b.occurrenceId);
    }
  }
  return result;
}

/** Day sections for the agenda list, in day order. Only days with events appear. */
export function agendaSections<T extends CalendarEvent>(
  occurrences: readonly Occurrence<T>[]
): { dayKey: string; data: Occurrence<T>[] }[] {
  return [...groupByDay(occurrences).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dayKey, data]) => ({ dayKey, data }));
}

/** 0 = Sunday … 6 = Saturday. */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * First day of the week for a locale (device locale by default), via
 * `Intl.Locale.weekInfo` where available. Falls back to Monday, except for
 * regions that conventionally start on Sunday or Saturday.
 */
export function weekStartForLocale(locale?: string): WeekStart {
  const tag = locale ?? (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : 'en-US');
  try {
    const loc = new Intl.Locale(tag) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    if (info && Number.isFinite(info.firstDay)) {
      // Intl uses 1 = Monday … 7 = Sunday.
      return (info.firstDay % 7) as WeekStart;
    }
    const region = loc.region ?? tag.split('-')[1];
    if (region && SUNDAY_REGIONS.has(region.toUpperCase())) return 0;
    if (region && SATURDAY_REGIONS.has(region.toUpperCase())) return 6;
  } catch {
    // Fall through to Monday.
  }
  return 1;
}

const SUNDAY_REGIONS = new Set(['US', 'CA', 'JP', 'BR', 'MX', 'PH', 'IN', 'IL', 'KR', 'TW', 'ZA', 'AU', 'HK']);
const SATURDAY_REGIONS = new Set(['AE', 'SA', 'EG', 'QA', 'KW', 'BH', 'OM', 'DZ', 'IQ', 'JO', 'LY']);

export type MonthCell = {
  dayKey: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
};

/** Days in a month (month0 is 0-based). */
export function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * The cells of a month grid: whole weeks (5 or 6 rows of 7) covering the
 * month, with leading/trailing days from the adjacent months. Pure calendar
 * arithmetic — the grid shows dates, not instants, so no zone is involved.
 */
export function monthMatrix(year: number, month0: number, weekStart: WeekStart, todayKey: string): MonthCell[][] {
  const firstWeekday = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const leading = (firstWeekday - weekStart + 7) % 7;
  const total = daysInMonth(year, month0);
  const rows = Math.ceil((leading + total) / 7);
  const cells: MonthCell[][] = [];
  // Start from the first visible day, which may be in the previous month.
  let cursor = Date.UTC(year, month0, 1 - leading);
  for (let r = 0; r < rows; r++) {
    const row: MonthCell[] = [];
    for (let c = 0; c < 7; c++) {
      const d = new Date(cursor);
      const key = dayKeyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      row.push({
        dayKey: key,
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === month0 && d.getUTCFullYear() === year,
        isToday: key === todayKey,
        weekday: d.getUTCDay(),
      });
      cursor += DAY_MS;
    }
    cells.push(row);
  }
  return cells;
}

/** Instants bounding the grid's first and last visible days, in `tz`, for fetching/expansion. */
export function matrixRange(matrix: MonthCell[][], tz: string = getDeviceTimeZone()): DayRange {
  const first = matrix[0]?.[0]?.dayKey;
  const lastRow = matrix[matrix.length - 1];
  const last = lastRow?.[lastRow.length - 1]?.dayKey;
  return { from: dayKeyToInstant(first ?? '1970-01-01', tz, 'start'), to: dayKeyToInstant(last ?? first ?? '1970-01-01', tz, 'end') };
}

/**
 * First or last instant of a calendar day in `tz` (local midnight / 23:59:59),
 * via the tested wall-clock conversion. A spring-forward gap at midnight
 * resolves forward like calendars do.
 */
export function dayKeyToInstant(key: string, tz: string, edge: 'start' | 'end' = 'start'): Date {
  const p = parseDayKey(key) ?? { year: 1970, month0: 0, day: 1 };
  const zone = isValidTimeZone(tz) ? tz : 'UTC';
  return edge === 'start'
    ? wallClockToUtc({ year: p.year, month: p.month0 + 1, day: p.day, hour: 0, minute: 0, second: 0 }, zone)
    : wallClockToUtc({ year: p.year, month: p.month0 + 1, day: p.day, hour: 23, minute: 59, second: 59 }, zone);
}

/** Month shift helper for the header arrows: returns { year, month0 } `delta` months away. */
export function shiftMonth(year: number, month0: number, delta: number): { year: number; month0: number } {
  const idx = year * 12 + month0 + delta;
  return { year: Math.floor(idx / 12), month0: ((idx % 12) + 12) % 12 };
}

/**
 * ICS inputs for exporting the enabled sources: one VEVENT per event. A
 * series stays a series (RRULE) anchored at its next occurrence so the
 * import doesn't start in the past; one-off events that have ended are
 * skipped. Cancelled events are skipped too.
 */
export function calendarIcsInputs<T extends CalendarEvent>(
  events: readonly T[],
  now: Date = new Date()
): IcsEventInput[] {
  const seen = new Set<string>();
  const out: IcsEventInput[] = [];
  for (const event of events) {
    if (seen.has(event.id) || isCancelled(event)) continue;
    seen.add(event.id);
    if (hasEventEnded(event, now)) continue;
    const start = new Date(event.start_datetime);
    const end = new Date(event.end_datetime);
    if (Number.isNaN(start.getTime())) continue;
    const duration = Number.isNaN(end.getTime()) || end <= start ? 60 * 60 * 1000 : end.getTime() - start.getTime();
    let anchor = start;
    if (event.is_recurring && event.recurrence_pattern) {
      const [next] = getNextOccurrences(event, 1, now);
      if (next) anchor = next;
    }
    out.push({
      id: event.id,
      title: event.title,
      startIso: anchor.toISOString(),
      endIso: new Date(anchor.getTime() + duration).toISOString(),
      address: event.address ?? null,
      description: event.description,
      recurrence: buildRecurrenceRule(event.recurrence_pattern, event.is_recurring, event.timezone, event.start_datetime),
      timezone: event.timezone ?? null,
    });
  }
  return out;
}

/**
 * "7:00 PM – 9:00 PM" for a row, in the event's zone when it has one (with
 * the zone abbreviation appended when the viewer's clock differs), otherwise
 * in the viewer's zone. The "your time" reading comes from `describeEventTime`.
 */
export function formatOccurrenceTimeRange(
  start: Date,
  end: Date,
  eventTz: string | null | undefined,
  viewerTz: string = getDeviceTimeZone(),
  locale?: string
): string {
  const zone = eventTz && isValidTimeZone(eventTz) ? eventTz : isValidTimeZone(viewerTz) ? viewerTz : 'UTC';
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const range = `${formatInZone(start, zone, opts, locale)} – ${formatInZone(end, zone, opts, locale)}`;
  if (zone !== viewerTz && describeEventTime(start, zone, viewerTz, locale).differs) {
    return `${range} ${zoneAbbreviation(zone, start, locale)}`;
  }
  return range;
}

/**
 * "Fri 10:00 AM → Sun 10:00 PM" for an occurrence listed on several days,
 * read in the event zone (viewer zone for legacy rows), with the zone
 * abbreviation appended when the viewer's clock differs.
 */
export function formatOccurrenceSpan(
  start: Date,
  end: Date,
  eventTz: string | null | undefined,
  viewerTz: string = getDeviceTimeZone(),
  locale?: string
): string {
  const zone = eventTz && isValidTimeZone(eventTz) ? eventTz : isValidTimeZone(viewerTz) ? viewerTz : 'UTC';
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', hour: 'numeric', minute: '2-digit' };
  const span = `${formatInZone(start, zone, opts, locale)} → ${formatInZone(end, zone, opts, locale)}`;
  if (zone !== viewerTz && describeEventTime(start, zone, viewerTz, locale).differs) {
    return `${span} ${zoneAbbreviation(zone, start, locale)}`;
  }
  return span;
}

export type DayMarker = {
  /** Source colour, or 'cancelled' for a day whose only plans were cancelled. */
  kind: CalendarSource | 'cancelled';
  /** Drawn hollow: every occurrence behind this marker is waiting for approval. */
  pending: boolean;
};

/**
 * Grid dots for one day: one per primary source among live occurrences, in
 * SOURCE_PRIORITY order, hollow when all of that source's occurrences are
 * pending requests. A day that only has cancelled occurrences gets a single
 * muted marker so the date can still be found and opened.
 */
export function dayMarkers<T extends CalendarEvent>(list: readonly Occurrence<T>[]): DayMarker[] {
  const live = new Map<CalendarSource, boolean>(); // source → all pending so far
  let cancelled = false;
  for (const occ of list) {
    if (isCancelled(occ.event)) {
      cancelled = true;
      continue;
    }
    const source = primarySource(occ);
    live.set(source, (live.get(source) ?? true) && occ.pending);
  }
  if (live.size === 0) return cancelled ? [{ kind: 'cancelled', pending: false }] : [];
  return SOURCE_PRIORITY.filter((s) => live.has(s)).map((s) => ({ kind: s, pending: live.get(s)! }));
}
