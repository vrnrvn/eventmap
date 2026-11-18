import type { RecurrencePattern } from '@/utils/recurrence';
import { occurrenceInProgress, type OccurrenceException } from '@/utils/occurrences';
import { dateKeyInZone, isValidTimeZone } from '@/utils/timezone';

export type EventTimingFields = {
  start_datetime: string;
  end_datetime: string;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  /** Event zone (20261103140000); null/undefined = compare on the device's calendar day. */
  timezone?: string | null;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}/;

/**
 * Whether an event is over. Mirrors the `event_has_ended` SQL helper so the
 * client and the attendance RPCs agree on what "past" means:
 *  - one-off events end at `end_datetime`
 *  - recurring events end once their recurrence end date has passed
 *  - recurring events without an end date never end
 */
export function hasEventEnded(event: EventTimingFields, now: Date = new Date()): boolean {
  if (!event.is_recurring) {
    const end = new Date(event.end_datetime);
    if (Number.isNaN(end.getTime())) return false;
    return end.getTime() <= now.getTime();
  }

  const endDate = event.recurrence_pattern?.endDate;
  if (!endDate || !DATE_ONLY.test(endDate)) return false;

  // Compare on calendar days in the event's zone when it has one (mirrors the
  // 4-arg event_has_ended server helper); otherwise on the device's calendar
  // day, like the legacy server behaviour.
  if (event.timezone && isValidTimeZone(event.timezone)) {
    return endDate.slice(0, 10) < dateKeyInZone(now, event.timezone);
  }
  const [y, m, d] = endDate.slice(0, 10).split('-').map(Number);
  const endOfLastDay = new Date(y, m - 1, d, 23, 59, 59, 999);
  return endOfLastDay.getTime() < now.getTime();
}

/**
 * Whether an event is happening right now. One-off events: between start and
 * end. Series: one of its occurrences is running, with skipped/moved dates
 * applied when the caller has them (`exceptions`; without them the plain
 * pattern is used, which is right unless today's date was skipped or moved).
 * Before 2026-11-17 series always returned false (EJ-2).
 */
export function isEventInProgress(
  event: EventTimingFields,
  now: Date = new Date(),
  exceptions: readonly OccurrenceException[] = []
): boolean {
  if (event.is_recurring) {
    if (hasEventEnded(event, now)) return false;
    return occurrenceInProgress(event, exceptions, now) !== null;
  }
  const start = new Date(event.start_datetime).getTime();
  const end = new Date(event.end_datetime).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return start <= now.getTime() && now.getTime() < end;
}

/**
 * A short "how soon" cue for an upcoming start, judged on calendar days in
 * `timeZone` (the event zone, else the viewer's): "Starts in 40 min" within
 * the hour, "Today · in 3 h" later the same day, "Tomorrow" for the next day
 * within 36 h; null otherwise or once it has started. The attendee page had
 * no same-day signal at all — surfaced by the rehearsal preview's "Day of"
 * scenario (owner decision 2026-11-17).
 */
export function startsSoonLabel(startIso: string, now: Date = new Date(), timeZone?: string | null): string | null {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;
  const diff = start.getTime() - now.getTime();
  if (diff <= 0) return null;
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `Starts in ${Math.max(1, minutes)} min`;
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : null;
  const dayOf = (d: Date) => {
    if (zone) return dateKeyInZone(d, zone);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  if (dayOf(start) === dayOf(now)) return `Today · in ${Math.round(diff / 3600000)} h`;
  if (diff < 36 * 3600000 && dayOf(start) === dayOf(new Date(now.getTime() + 24 * 3600000))) return 'Tomorrow';
  return null;
}
