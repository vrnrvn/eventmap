/**
 * When a duplicated event should run.
 *
 * `duplicate_event` (20261103170000:840) shifts the copy by
 * `(now() + 7 days) - start` whenever the source is in the past, which lands
 * the copy at the *current clock time* a week out — 14:37:22 instead of 19:00
 * — and does that arithmetic in UTC, so a daylight-saving change inside that
 * week moves the local start by an hour. "Run it again" is mostly used on an
 * event that has already happened, so that is exactly the case that broke.
 *
 * Here the copy keeps the source's **local time of day and duration**, on a
 * day the host picks, resolved in the event's own zone. The prepared v2 RPC
 * (`supabase/prepared/2026-11-18_duplicate_v2/`) does the same thing on the
 * server; until it is applied the client sets the date on the fresh draft,
 * which a plain update is allowed to do (`guard_event_time_changes` lets any
 * draft through).
 */
import { dateKeyInZone, utcToWallClock, wallClockToUtc } from '@/utils/timezone';

/** 'YYYY-MM-DD' → the same key `days` later. Pure calendar arithmetic. */
export function addDaysToKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.slice(0, 10).split('-').map(Number);
  // Noon UTC: far from any DST edge, so adding whole days never slips a date.
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  at.setUTCDate(at.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** 0 = Sunday, like Date#getDay. */
export function dayOfWeekForKey(dayKey: string): number {
  const [y, m, d] = dayKey.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/**
 * The day to offer first, as 'YYYY-MM-DD' in `zone`:
 * - an event still ahead → a week after it, the host's usual "same thing again
 *   next week";
 * - an event that has happened → the next time its weekday comes round,
 *   strictly after today. A Saturday class last month offers next Saturday.
 *
 * Always a future day, so the copy can be published (`publish_event` refuses
 * an event that is already over).
 */
export function defaultRunAgainDay(sourceStart: Date, zone: string, now: Date = new Date()): string {
  const sourceKey = dateKeyInZone(sourceStart, zone);
  const todayKey = dateKeyInZone(now, zone);
  if (sourceKey > todayKey) return addDaysToKey(sourceKey, 7);

  const wanted = dayOfWeekForKey(sourceKey);
  let key = addDaysToKey(todayKey, 1);
  for (let i = 0; i < 7; i += 1) {
    if (dayOfWeekForKey(key) === wanted) return key;
    key = addDaysToKey(key, 1);
  }
  /* istanbul ignore next — a weekday always recurs within 7 days. */
  return key;
}

/**
 * The copy's start and end: the source's wall-clock time of day on `dayKey`,
 * in `zone`, keeping the source's exact duration. DST-safe both ways —
 * `wallClockToUtc` resolves the offset that applies on the new day, so "19:00"
 * stays 19:00 even when the clocks moved in between.
 */
export function runAgainWhen(
  source: { start: Date; end: Date },
  dayKey: string,
  zone: string
): { start: Date; end: Date } {
  const w = utcToWallClock(source.start, zone);
  const [year, month, day] = dayKey.slice(0, 10).split('-').map(Number);
  const start = wallClockToUtc({ ...w, year, month, day }, zone);
  const duration = Math.max(0, source.end.getTime() - source.start.getTime());
  return { start, end: new Date(start.getTime() + duration) };
}

/**
 * `duplicate_event` v2's refusals (20261118110000) in the host's words; any
 * other failure gets the generic retry line. The sheet already keeps the start
 * in the future, so the first two only fire on a clock that drifted while it
 * was open.
 */
export function duplicateRefusalMessage(err: unknown): string {
  const message = (err as { message?: string } | null)?.message ?? '';
  if (/new start must be in the future/i.test(message)) return 'Pick a start time in the future.';
  if (/new end must be after the new start/i.test(message)) return 'The end has to be after the start.';
  if (/account suspended/i.test(message)) return 'Your account is suspended, so you can’t create events.';
  if (/only the event host/i.test(message)) return 'Only the host can run this event again.';
  return 'Could not duplicate. Please try again.';
}
