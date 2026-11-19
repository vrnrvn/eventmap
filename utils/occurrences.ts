/**
 * Occurrences of a recurring series with per-date exceptions applied
 * (event_occurrence_exceptions, migration 20261109140000). Pure, so the
 * rules are unit-tested; mirrors the SQL event_next_effective_occurrence.
 *
 * Dates are keyed by the ORIGINAL calendar date in the event's zone
 * ('YYYY-MM-DD'), the same key the server stores.
 */
import { getNextOccurrences, type RecurrencePattern } from '@/utils/recurrence';
import { dateKeyInZone, isValidTimeZone } from '@/utils/timezone';

export type OccurrenceException = {
  event_id: string;
  occurrence_date: string;
  kind: 'cancelled' | 'rescheduled';
  new_start: string | null;
  new_end: string | null;
  note: string | null;
};

export type OccurrenceStatus = 'scheduled' | 'cancelled' | 'moved';

export type Occurrence = {
  /** Original date key in the event zone. */
  dateKey: string;
  /** Start actually in effect (moved time for 'moved'; original otherwise). */
  start: Date;
  end: Date;
  /** Original start (differs from `start` only when moved). */
  originalStart: Date;
  status: OccurrenceStatus;
  note: string | null;
};

type SeriesEvent = {
  start_datetime: string;
  end_datetime: string;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  timezone?: string | null;
};

/** Date key of an instant in the event zone (device zone for legacy events). */
export function occurrenceDateKey(at: Date, timezone?: string | null): string {
  if (timezone && isValidTimeZone(timezone)) return dateKeyInZone(at, timezone);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

/**
 * The next `count` occurrences from `now`, with exceptions applied and sorted
 * by the start in effect. Cancelled dates are included (for the host's list
 * and the struck-through attendee view) unless `includeCancelled` is false;
 * they do not count towards `count` in that case.
 */
export function listOccurrences(
  event: SeriesEvent,
  exceptions: readonly OccurrenceException[],
  {
    count = 8,
    now = new Date(),
    includeCancelled = true,
    strict = false,
  }: {
    count?: number;
    now?: Date;
    includeCancelled?: boolean;
    /**
     * Drop occurrences whose effective start is before `now`. The default
     * walk starts at midnight so a 19:00 date still lists at 21:00 (the
     * calendar wants that); "Next:" displays want strict (G2).
     */
    strict?: boolean;
  } = {}
): Occurrence[] {
  if (!event.is_recurring || !event.recurrence_pattern) return [];
  const duration = Math.max(new Date(event.end_datetime).getTime() - new Date(event.start_datetime).getTime(), 0);
  const byKey = new Map(exceptions.map((x) => [x.occurrence_date.slice(0, 10), x]));
  // Over-fetch so cancelled dates don't leave the list short.
  const raw = getNextOccurrences(event, count + byKey.size + 1, now);
  const out: Occurrence[] = [];
  for (const originalStart of raw) {
    if (strict && originalStart.getTime() < now.getTime() && !byKey.has(occurrenceDateKey(originalStart, event.timezone))) continue;
    const dateKey = occurrenceDateKey(originalStart, event.timezone);
    const ex = byKey.get(dateKey);
    if (ex?.kind === 'cancelled') {
      if (includeCancelled && !(strict && originalStart.getTime() < now.getTime())) {
        out.push({ dateKey, start: originalStart, end: new Date(originalStart.getTime() + duration), originalStart, status: 'cancelled', note: ex.note });
      }
      continue;
    }
    if (ex?.kind === 'rescheduled' && ex.new_start && ex.new_end) {
      const start = new Date(ex.new_start);
      if (start.getTime() < now.getTime()) continue; // moved into the past
      out.push({ dateKey, start, end: new Date(ex.new_end), originalStart, status: 'moved', note: ex.note });
      continue;
    }
    out.push({ dateKey, start: originalStart, end: new Date(originalStart.getTime() + duration), originalStart, status: 'scheduled', note: null });
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  const live = out.filter((o) => o.status !== 'cancelled').slice(0, count);
  if (!includeCancelled) return live;
  // Cancelled dates are shown only within the span of the live ones.
  const lastLive = live[live.length - 1];
  return out.filter((o) => (o.status === 'cancelled' ? !lastLive || o.start <= lastLive.start : live.includes(o)));
}

/**
 * The occurrence running at `now` (start <= now < end), with exceptions
 * applied, or null. A skipped date is never in progress and a moved date
 * runs at its new time (docs/EVENT_JOURNEY_REVIEW_2026-11-17.md EJ-2).
 *
 * The walk starts at `now - duration` so a session that crossed midnight
 * (22:00–02:00) is still found at 01:00; the non-strict walk also lists
 * the earlier slot of that day, so a few candidates are enough.
 */
export function occurrenceInProgress(
  event: SeriesEvent,
  exceptions: readonly OccurrenceException[] = [],
  now: Date = new Date()
): Occurrence | null {
  if (!event.is_recurring || !event.recurrence_pattern) return null;
  const duration = Math.max(new Date(event.end_datetime).getTime() - new Date(event.start_datetime).getTime(), 0);
  if (duration === 0) return null;
  const t = now.getTime();
  const running = (o: Occurrence) => o.status !== 'cancelled' && o.start.getTime() <= t && t < o.end.getTime();
  // A moved date is generated from its ORIGINAL day, which can be any
  // distance from its new time, so look those up from their own day.
  for (const x of exceptions) {
    if (x.kind !== 'rescheduled' || !x.new_start || !x.new_end) continue;
    if (!(new Date(x.new_start).getTime() <= t && t < new Date(x.new_end).getTime())) continue;
    const dayBefore = new Date(Date.parse(`${x.occurrence_date.slice(0, 10)}T00:00:00Z`) - 24 * 60 * 60 * 1000);
    const hit = listOccurrences(event, exceptions, { count: 3, now: dayBefore, includeCancelled: false }).find(
      (o) => o.dateKey === x.occurrence_date.slice(0, 10)
    );
    if (hit && running(hit)) return hit;
  }
  const from = new Date(t - duration);
  return listOccurrences(event, exceptions, { count: 3, now: from, includeCancelled: false }).find(running) ?? null;
}

/**
 * The attendee's "upcoming dates" rows: up to `count` dates that have not
 * finished yet (a date that already ended today is dropped, so it can't be
 * RSVP'd after the fact — EJ-13), with the running one flagged. Cancelled
 * dates within that span are kept, as in `listOccurrences`.
 */
export function upcomingDateRows(
  event: SeriesEvent,
  exceptions: readonly OccurrenceException[],
  { count = 5, now = new Date() }: { count?: number; now?: Date } = {}
): Array<Occurrence & { inProgress: boolean }> {
  const t = now.getTime();
  // +1: the non-strict walk can include one date that already finished today.
  const notFinished = listOccurrences(event, exceptions, { count: count + 1, now }).filter((o) => o.end.getTime() > t);
  const out: Array<Occurrence & { inProgress: boolean }> = [];
  let happening = 0;
  for (const o of notFinished) {
    if (o.status !== 'cancelled') {
      if (happening === count) break;
      happening += 1;
    }
    out.push({ ...o, inProgress: o.status !== 'cancelled' && o.start.getTime() <= t });
  }
  return out;
}

/**
 * Whether moving a date to `newStart` would put it after the series' end
 * date. A series counts as ended once its `endDate` day has passed
 * (event_has_ended), so a date moved beyond it would read as ended on the
 * day it happens — no RSVPs, no reminder (EJ-14). Since 20261117140000 the
 * server handles it: reschedule_occurrence extends `endDate` to the moved day
 * when that adds no other date, and refuses otherwise, naming the date it
 * would add. This is now advisory only — the move picker says what will
 * happen instead of blocking it.
 */
export function moveIsPastSeriesEnd(
  newStart: Date,
  timezone: string | null | undefined,
  seriesEndDate: string | null | undefined
): boolean {
  if (!seriesEndDate || !/^\d{4}-\d{2}-\d{2}/.test(seriesEndDate)) return false;
  return occurrenceDateKey(newStart, timezone) > seriesEndDate.slice(0, 10);
}

/** Next date actually happening (skips cancelled, uses moved times), or null. */
export function nextEffectiveOccurrence(
  event: SeriesEvent,
  exceptions: readonly OccurrenceException[],
  now: Date = new Date()
): Occurrence | null {
  return listOccurrences(event, exceptions, { count: 1, now, includeCancelled: false, strict: true })[0] ?? null;
}

/**
 * ISO start to show as a series' "next" date on cards and lists: the next
 * effective occurrence at or after `now`; the server's `next_start_datetime`
 * when there are no exceptions and it is still ahead (it is the ranking's
 * value, so lists stay consistent with their order); else the series start.
 */
export function effectiveNextStartIso(
  event: SeriesEvent & { next_start_datetime?: string | null },
  exceptions: readonly OccurrenceException[],
  now: Date = new Date()
): string {
  if (!event.is_recurring || !event.recurrence_pattern) return event.start_datetime;
  const server = event.next_start_datetime ? new Date(event.next_start_datetime) : null;
  if (exceptions.length === 0 && server && !Number.isNaN(server.getTime()) && server.getTime() >= now.getTime()) {
    return server.toISOString();
  }
  return nextEffectiveOccurrence(event, exceptions, now)?.start.toISOString() ?? event.start_datetime;
}

/**
 * Upcoming exceptions in the shape utils/eventIcs expects (original start
 * instant + new times). Only dates still ahead are exported.
 */
export function exceptionsForIcs(
  event: SeriesEvent,
  exceptions: readonly OccurrenceException[],
  now: Date = new Date()
): { originalStartIso: string; kind: 'cancelled' | 'rescheduled'; newStartIso?: string | null; newEndIso?: string | null }[] {
  if (exceptions.length === 0) return [];
  return listOccurrences(event, exceptions, { count: 200, now })
    .filter((o) => o.status !== 'scheduled')
    .map((o) =>
      o.status === 'cancelled'
        ? { originalStartIso: o.originalStart.toISOString(), kind: 'cancelled' as const }
        : {
            originalStartIso: o.originalStart.toISOString(),
            kind: 'rescheduled' as const,
            newStartIso: o.start.toISOString(),
            newEndIso: o.end.toISOString(),
          }
    );
}

export type DateRsvpOverride = { occurrence_date: string; status: 'going' | 'not_going' | 'waitlist' };
export type DateAttendance = 'going' | 'not_going' | 'waitlist' | 'none';

/**
 * Whether the viewer attends one date of a series (Phase F): a per-date
 * override wins; otherwise the series RSVP decides ('going' → going).
 * 'interested' / 'requested' series RSVPs don't count as going a date.
 */
export function dateAttendance(
  seriesStatus: string | null | undefined,
  overrides: readonly DateRsvpOverride[],
  dateKey: string
): DateAttendance {
  const o = overrides.find((x) => x.occurrence_date.slice(0, 10) === dateKey);
  if (o) return o.status;
  return seriesStatus === 'going' ? 'going' : 'none';
}

/**
 * What tapping a date's toggle should store: the override that flips the
 * date, or null to clear an override that now matches the series default.
 */
export function nextDateOverride(
  seriesStatus: string | null | undefined,
  current: DateAttendance
): 'going' | 'not_going' | null {
  // Tapping while waitlisted leaves the waitlist (clears the row).
  if (current === 'waitlist') return null;
  const seriesGoing = seriesStatus === 'going';
  const wantGoing = current !== 'going';
  if (wantGoing === seriesGoing) return null; // back to the series default
  return wantGoing ? 'going' : 'not_going';
}

/**
 * Whether a series actually meets inside [from, to], with per-date
 * exceptions applied: a skipped date does not count, and a date moved into
 * the window does. Used to drop series from a date-filtered list whose only
 * date in that window was skipped (Discover "Today" / "This weekend").
 *
 * One-off events and series with no exceptions are left to the caller's
 * cheaper check (`filterEventsByDateRange`).
 */
export function hasEffectiveDateInRange(
  event: SeriesEvent,
  exceptions: readonly OccurrenceException[],
  from: Date,
  to: Date
): boolean {
  if (!event.is_recurring || !event.recurrence_pattern) {
    const start = new Date(event.start_datetime).getTime();
    return start >= from.getTime() && start <= to.getTime();
  }
  // Over-fetch: the walk starts at the window's first day, and cancelled
  // dates in between must not crowd out a live one later in the window.
  const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const occurrences = listOccurrences(event, exceptions, {
    count: days + exceptions.length + 1,
    now: from,
    includeCancelled: false,
  });
  return occurrences.some((o) => o.start.getTime() >= from.getTime() && o.start.getTime() <= to.getTime());
}
