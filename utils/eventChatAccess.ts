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
