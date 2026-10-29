/**
 * Pure helpers for the event chat screen: ordering, grouping, labels, link and
 * mention parsing. Kept dependency-free so they can be unit tested with node.
 */

export type ChatMessageLike = {
  id: string;
  sender_id: string;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  localStatus?: 'sending' | 'failed';
};

export const GROUP_GAP_MS = 5 * 60 * 1000;
export const MENTION_TRIGGER = /(^|\s)@([^\s@]{0,30})$/;
export const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"')\]]*[^\s<>"')\].,!?;:])/gi;

export function sortMessages<T extends ChatMessageLike>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

export function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Consecutive messages from one sender within GROUP_GAP_MS on the same day collapse into a group. */
export function isGrouped(older: ChatMessageLike, newer: ChatMessageLike): boolean {
  return (
    !older.deleted_at &&
    !newer.deleted_at &&
    older.sender_id === newer.sender_id &&
    dayKey(older.created_at) === dayKey(newer.created_at) &&
    new Date(newer.created_at).getTime() - new Date(older.created_at).getTime() <= GROUP_GAP_MS
  );
}

export function typingLabel(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return 'Several people are typing…';
}

export function tombstoneLabel(
  message: ChatMessageLike,
  viewerId: string | undefined,
  hostOrAdmin: boolean
): string {
  if (!message.deleted_by) return 'Message removed';
  if (message.deleted_by === message.sender_id) {
    return message.sender_id === viewerId ? 'You deleted this message' : 'Message deleted';
  }
  if (message.deleted_by === viewerId && hostOrAdmin) return 'You removed this message';
  return 'Removed by a moderator';
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex matching `@Name` for the given display names (longest first so a
 * name that prefixes another never wins), bounded so `@Ana` doesn't match
 * inside `@Anaïs`. Returns null when there is nothing to highlight.
 */
export function buildMentionPattern(names: string[]): RegExp | null {
  const unique = Array.from(new Set(names.filter((name) => name.trim().length > 0)));
  if (unique.length === 0) return null;
  const alternatives = unique.sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
  return new RegExp(`(@(?:${alternatives}))(?![A-Za-z0-9_\\u00C0-\\u024F])`, 'g');
}

export type BodySegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'mention'; text: string };

/** Splits a message body into plain text, tappable links and highlighted mentions. */
export function segmentBody(body: string, mentionNames: string[]): BodySegment[] {
  const mentionPattern = buildMentionPattern(mentionNames);
  const out: BodySegment[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    if (!mentionPattern) {
      out.push({ kind: 'text', text });
      return;
    }
    const chunks = text.split(mentionPattern);
    chunks.forEach((chunk, index) => {
      if (!chunk) return;
      out.push(index % 2 === 1 ? { kind: 'mention', text: chunk } : { kind: 'text', text: chunk });
    });
  };
  const parts = body.split(URL_PATTERN);
  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      pushText(part);
    } else {
      out.push({ kind: 'link', text: part, href: part.startsWith('www.') ? `https://${part}` : part });
    }
  });
  return out;
}

/** Mentions that are still present in the final text, by id. */
export function resolveMentions(
  body: string,
  drafted: { name: string; id: string }[]
): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of drafted) {
    const pattern = buildMentionPattern([entry.name]);
    if (pattern && pattern.test(body)) result.set(entry.id, entry.name);
  }
  return result;
}
