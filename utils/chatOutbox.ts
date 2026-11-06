/**
 * What a chat room keeps on the device besides the cached transcript
 * (docs/OFFLINE_PLAN.md §3.7): the composer draft and messages that haven't
 * reached the server yet. Pure — unit-tested under node.
 *
 * Unsent messages keep their client-generated id, so re-sending one that did
 * land is recognised as success (services/eventChat sendMessage).
 */

/** Unsent messages older than this are dropped instead of being re-sent. */
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** The newest messages of a room kept for offline reading. */
export const CACHED_ROOM_MESSAGES = 50;

export const outboxKey = (userId: string, eventId: string) => `eventmap.chat.outbox.${userId}.${eventId}`;
export const outboxPrefix = (userId: string) => `eventmap.chat.outbox.${userId}.`;

type LocalMessage = {
  id: string;
  body: string;
  created_at: string;
  localStatus?: 'sending' | 'failed';
  autoRetry?: boolean;
};

export type Outbox<M extends LocalMessage> = {
  draft: string;
  draftMentions: { id: string; name: string }[];
  pending: M[];
};

const fresh = (m: { created_at: string }, now: number) => now - new Date(m.created_at).getTime() < OUTBOX_MAX_AGE_MS;

/** The outbox for the current screen state, or null when there's nothing to keep. */
export function buildOutbox<M extends LocalMessage>(
  messages: readonly M[],
  draft: string,
  draftMentions: { id: string; name: string }[],
  now = Date.now()
): Outbox<M> | null {
  const pending = messages.filter((m) => m.localStatus && fresh(m, now));
  if (pending.length === 0 && !draft.trim()) return null;
  return { draft, draftMentions: draft.trim() ? draftMentions : [], pending };
}

/**
 * A stored outbox, with anything that was mid-send when the app stopped
 * marked as failed-for-connection (re-sent automatically; the id makes that
 * safe). Expired and malformed entries are dropped.
 */
export function parseOutbox<M extends LocalMessage>(raw: string | null | undefined, now = Date.now()): Outbox<M> | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<Outbox<M>>;
    const pending = (Array.isArray(data.pending) ? data.pending : [])
      .filter(
        (m): m is M =>
          typeof m === 'object' &&
          m !== null &&
          typeof m.id === 'string' &&
          typeof m.body === 'string' &&
          typeof m.created_at === 'string' &&
          fresh(m, now)
      )
      .map((m) => (m.localStatus === 'sending' ? { ...m, localStatus: 'failed' as const, autoRetry: true } : m));
    const draft = typeof data.draft === 'string' ? data.draft : '';
    const draftMentions = Array.isArray(data.draftMentions)
      ? data.draftMentions.filter((x) => typeof x?.id === 'string' && typeof x?.name === 'string')
      : [];
    if (pending.length === 0 && !draft.trim()) return null;
    return { draft, draftMentions, pending };
  } catch {
    return null;
  }
}

/** Messages waiting for a connection that should be re-sent now. */
export function messagesToAutoRetry<M extends LocalMessage>(messages: readonly M[], now = Date.now()): M[] {
  return messages.filter((m) => m.localStatus === 'failed' && m.autoRetry && fresh(m, now));
}

/** Merges restored unsent messages into a transcript, skipping ones the server already has. */
export function mergePending<M extends { id: string }>(server: readonly M[], pending: readonly M[]): M[] {
  const have = new Set(server.map((m) => m.id));
  return [...server, ...pending.filter((m) => !have.has(m.id))];
}
