/**
 * Whether an attendee can open an event's chat, mirroring the server rule in
 * user_can_access_event_chat (20261103160000): the chat is not 'off', the
 * viewer is going, and either the host allows any attendee ('any_going') or
 * at least one other person is going ('two_going', the default).
 *
 * `settings` is null until the chat status has loaded (or on a backend
 * without the chat-mode columns); the defaults then match the server's.
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
  settings: ChatAccessSettings
): ChatAccess {
  const mode = settings?.chat_mode ?? 'open';
  if (mode === 'off') return { state: 'off' };
  if (userRsvp !== 'going') return { state: 'join' };
  const anyGoing = settings?.open_policy === 'any_going';
  if (!anyGoing && goingCount < 2) return { state: 'waiting' };
  return { state: 'open', announcementsOnly: mode === 'announcements' };
}
