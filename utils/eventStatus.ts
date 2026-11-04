import type { RecurrencePattern } from '@/utils/recurrence';
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

/** Whether an event has started but not yet ended (one-off events only). */
export function isEventInProgress(event: EventTimingFields, now: Date = new Date()): boolean {
  if (event.is_recurring) return false;
  const start = new Date(event.start_datetime).getTime();
  const end = new Date(event.end_datetime).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return start <= now.getTime() && now.getTime() < end;
}
