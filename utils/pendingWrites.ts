import type { ErrorClass } from './networkErrors';
import type { ConnectivityStatus } from './connectivity';

/**
 * Writes that can wait for a connection (docs/OFFLINE_PLAN.md §3.7): saves,
 * follows, collection pins and notification read / dismiss. Pure module — unit-tested under
 * node; services/pendingWrites.ts stores and replays the queue.
 *
 * The queue holds the user's latest *intent* per target rather than a log of
 * calls: saving and then unsaving an event offline leaves one "unsave". Every
 * service call behind it is idempotent (a duplicate insert is treated as
 * success, deletes and read-marks repeat harmlessly), so replaying an entry
 * that already reached the server is safe.
 *
 * RSVPs are deliberately not queued: capacity and approval are decided by
 * the server, so a queued "going" would promise a spot that may not exist.
 */

export type PendingWrite =
  | { kind: 'save'; targetId: string; on: boolean; label?: string }
  | { kind: 'follow'; targetId: string; on: boolean; label?: string }
  /**
   * Pin / unpin an event in a collection. targetId is
   * `${collectionId}:${eventId}` (utils/collections collectionItemTarget) so
   * one key covers the pair; `collectionName` is for the toast copy.
   */
  | { kind: 'collectionItem'; targetId: string; on: boolean; label?: string; collectionName?: string }
  /** targetId '*' = mark all as read. */
  | { kind: 'notificationRead'; targetId: string }
  | { kind: 'notificationDelete'; targetId: string };

export type PendingEntry = PendingWrite & { queuedAt: number; attempts: number };

/** Entries that kept failing for reasons other than the connection are dropped after this. */
export const MAX_ATTEMPTS = 5;
/** Intents older than this are dropped rather than replayed. */
export const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const pendingKey = (w: PendingWrite) => `${w.kind}:${w.targetId}`;

/**
 * Whether a connectivity change should replay the queue. Any step towards a
 * working connection counts: leaving `offline` (even into `degraded`, the
 * request layer will tell us if it fails) and `degraded` → `online`. The
 * second case matters because writes that hit a connection error while the
 * device looked connected are queued too; without it they waited for the
 * next app foreground or the next offline cycle.
 */
export function shouldFlushOnTransition(previous: ConnectivityStatus, next: ConnectivityStatus): boolean {
  if (previous === next) return false;
  if (previous === 'offline') return next !== 'offline';
  return next === 'online';
}

/** Adds `write`, replacing any earlier intent it supersedes. */
export function enqueueWrite(queue: readonly PendingEntry[], write: PendingWrite, now: number): PendingEntry[] {
  const key = pendingKey(write);
  const superseded = (e: PendingEntry) =>
    pendingKey(e) === key ||
    // Dismissing a notification makes a pending read-mark for it pointless,
    // and "mark all read" covers every single read-mark.
    (write.kind === 'notificationDelete' && e.kind === 'notificationRead' && e.targetId === write.targetId) ||
    (write.kind === 'notificationRead' && write.targetId === '*' && e.kind === 'notificationRead');
  return [...queue.filter((e) => !superseded(e)), { ...write, queuedAt: now, attempts: 0 }];
}

/** Removes the entry for the same target (its intent was just carried out directly). */
export function removeWrite(queue: readonly PendingEntry[], write: PendingWrite): PendingEntry[] {
  const key = pendingKey(write);
  return queue.filter((e) => pendingKey(e) !== key);
}

export type ReplayOutcome = 'done' | 'retry-later' | 'drop';

/**
 * What to do with an entry after a replay attempt failed with `errorClass`:
 * - connection problems: keep it and stop replaying for now
 * - the server refused (RLS, event deleted…): drop it, it can never succeed
 * - anything else: retry later, up to MAX_ATTEMPTS
 */
export function outcomeForFailure(errorClass: ErrorClass, attempts: number): ReplayOutcome {
  if (errorClass === 'client') return 'drop';
  if (errorClass === 'network' || errorClass === 'timeout') return 'retry-later';
  return attempts + 1 >= MAX_ATTEMPTS ? 'drop' : 'retry-later';
}

/** Parses a stored queue, keeping only well-formed, unexpired entries. */
export function parseQueue(raw: string | null | undefined, now: number): PendingEntry[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter((e): e is PendingEntry => {
      if (typeof e !== 'object' || e === null) return false;
      const x = e as Partial<PendingEntry> & { on?: unknown };
      const kindOk =
        ((x.kind === 'save' || x.kind === 'follow' || x.kind === 'collectionItem') && typeof x.on === 'boolean') ||
        x.kind === 'notificationRead' ||
        x.kind === 'notificationDelete';
      return (
        kindOk &&
        typeof x.targetId === 'string' &&
        x.targetId.length > 0 &&
        typeof x.queuedAt === 'number' &&
        now - x.queuedAt < MAX_PENDING_AGE_MS &&
        typeof x.attempts === 'number'
      );
    });
  } catch {
    return [];
  }
}

/** Short description for a "couldn't sync" message. */
export function describeWrite(w: PendingWrite): string {
  const name = 'label' in w && w.label ? `“${w.label}”` : null;
  switch (w.kind) {
    case 'save':
      return w.on ? `save ${name ?? 'an event'}` : `remove ${name ?? 'an event'} from saved`;
    case 'follow':
      return w.on ? `follow ${name ?? 'an organizer'}` : `unfollow ${name ?? 'an organizer'}`;
    case 'collectionItem': {
      const list = w.collectionName ? `“${w.collectionName}”` : 'a collection';
      return w.on ? `add ${name ?? 'an event'} to ${list}` : `remove ${name ?? 'an event'} from ${list}`;
    }
    case 'notificationRead':
      return w.targetId === '*' ? 'mark notifications as read' : 'mark a notification as read';
    case 'notificationDelete':
      return 'dismiss a notification';
  }
}

/**
 * Toast copy when a write was queued instead of sent, or null to stay quiet
 * (notification read / dismiss are too frequent to announce).
 */
export function queuedMessage(w: PendingWrite): string | null {
  const tail = " It will sync when you're back online.";
  switch (w.kind) {
    case 'save':
      return (w.on ? 'Saved on this device.' : 'Removed on this device.') + tail;
    case 'follow':
      return (w.on ? 'Following on this device.' : 'Unfollowed on this device.') + tail;
    case 'collectionItem':
      return (w.on ? 'Added on this device.' : 'Removed on this device.') + tail;
    default:
      return null;
  }
}

/**
 * Applies queued notification read / dismiss intents to freshly loaded rows,
 * so a reload that lands before the queue replays doesn't bring a dismissed
 * notification back or show a read one as unread.
 */
export function overlayNotificationWrites<N extends { id: string; read: boolean }>(
  items: readonly N[],
  queue: readonly PendingWrite[]
): N[] {
  const deleted = new Set(queue.filter((w) => w.kind === 'notificationDelete').map((w) => w.targetId));
  const reads = queue.filter((w) => w.kind === 'notificationRead');
  const allRead = reads.some((w) => w.targetId === '*');
  const read = new Set(reads.map((w) => w.targetId));
  return items
    .filter((n) => !deleted.has(n.id))
    .map((n) => (!n.read && (allRead || read.has(n.id)) ? { ...n, read: true } : n));
}
