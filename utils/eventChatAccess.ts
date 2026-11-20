/**
 * Whether an attendee can open an event's chat, mirroring the server rule in
 * event_chat_member / user_can_access_event_chat (20261103160000, widened by
 * 20261117130000): the chat is not 'off', the viewer is going — by a series
 * RSVP *or* a per-date one (EJ-19) — and either the host allows any attendee
 * ('any_going') or at least one other person is going ('two_going', the
 * default).
 *
 * `settings` is null until the chat status has loaded (or on a backend
 * without the chat-mode columns); the defaults then match the server's.
 *
 * Known gap, by design: `goingCount` is the series "going" count
 * (`rsvp_count`), which the server also counts date-only goers towards. A
 * series whose only attendees are two date-only goers therefore reads
 * 'waiting' here while the server opens the chat. The event page closes that
 * gap with the server's own answer (`get_event_chat_post_status.can_read`);
 * this rule is the offline/pre-status default and the copy's reason.
 */
import type { EventTimingFields } from '@/utils/eventStatus';
import { dateKeyInZone, isValidTimeZone, wallClockToUtc } from '@/utils/timezone';

/**
 * D1 (EJ-7): posting stays open this many days after the event is over, then
 * the chat is read-only. Mirrors `event_chat_posting_open`
 * (20261118150000); the server's INSERT policy and `can_post` are what
 * actually enforce it — this constant only drives copy and row visibility.
 */
export const CHAT_AFTER_END_DAYS = 7;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}/;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ChatPostingWindow = {
  /** Whether posting is still allowed (by time alone — bans etc. are the server's). */
  open: boolean;
  /**
   * An instant on the last day posting is open, for date-only display
   * ("Chat open until <day>" / "closed on <day>"). null = never closes
   * (a series without an end date) or the end is unparseable.
   */
  closesOn: Date | null;
};

/**
 * When this event's chat stops accepting posts. Mirrors
 * `event_chat_posting_open` (20261118150000):
 *  - one-off (cancelled included, from its scheduled end): end + 7 days;
 *  - series with an endDate: whole calendar days in the event's zone — open
 *    through endDate + 7, closed from the 8th day;
 *  - series without an endDate: never closes.
 * Like `hasEventEnded`, a series without a usable zone counts days on the
 * device's calendar (the server falls back to UTC; they differ only for
 * events with no stored timezone, for at most a day).
 */
export function chatPostingWindow(event: EventTimingFields, now: Date = new Date()): ChatPostingWindow {
  if (!event.is_recurring) {
    const end = new Date(event.end_datetime);
    if (Number.isNaN(end.getTime())) return { open: true, closesOn: null };
    const closes = new Date(end.getTime() + CHAT_AFTER_END_DAYS * DAY_MS);
    return { open: closes.getTime() > now.getTime(), closesOn: closes };
  }
  const endDate = event.recurrence_pattern?.endDate;
  if (!endDate || !DATE_ONLY.test(endDate)) return { open: true, closesOn: null };
  const [y, m, d] = endDate.slice(0, 10).split('-').map(Number);
  // The last open calendar day, as a date key (Date.UTC normalises overflow).
  const lastOpen = new Date(Date.UTC(y, m - 1, d + CHAT_AFTER_END_DAYS));
  const lastOpenKey = lastOpen.toISOString().slice(0, 10);
  const tz = event.timezone && isValidTimeZone(event.timezone) ? event.timezone : null;
  const todayKey = tz ? dateKeyInZone(now, tz) : localDateKey(now);
  const closesOn = tz
    ? wallClockToUtc(
        {
          year: lastOpen.getUTCFullYear(),
          month: lastOpen.getUTCMonth() + 1,
          day: lastOpen.getUTCDate(),
          hour: 12,
          minute: 0,
          second: 0,
        },
        tz
      )
    : new Date(lastOpen.getUTCFullYear(), lastOpen.getUTCMonth(), lastOpen.getUTCDate(), 12);
  return { open: todayKey <= lastOpenKey, closesOn };
}

function localDateKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export type ChatAccessSettings = {
  chat_mode?: 'open' | 'announcements' | 'off' | null;
  open_policy?: 'two_going' | 'any_going' | null;
} | null;

export type ChatAccess =
  | { state: 'open'; announcementsOnly: boolean }
  | { state: 'off' }
  | { state: 'join' }
  | { state: 'waiting' };

export function eventChatAccess(
  userRsvp: string | null | undefined,
  goingCount: number,
  settings: ChatAccessSettings,
  /** EJ-19: the viewer is going to at least one date of a series. */
  opts: { dateGoing?: boolean } = {}
): ChatAccess {
  const mode = settings?.chat_mode ?? 'open';
  if (mode === 'off') return { state: 'off' };
  const seriesGoing = userRsvp === 'going';
  const dateGoing = opts.dateGoing === true;
  if (!seriesGoing && !dateGoing) return { state: 'join' };
  const anyGoing = settings?.open_policy === 'any_going';
  // A series goer is themselves inside `goingCount`; a date-only goer is not,
  // so any series goer at all is already "someone else going" for them.
  const othersGoing = seriesGoing ? goingCount >= 2 : goingCount >= 1;
  if (!anyGoing && !othersGoing) return { state: 'waiting' };
  return { state: 'open', announcementsOnly: mode === 'announcements' };
}
