import AsyncStorage from '@react-native-async-storage/async-storage';
import { socialService } from '@/services/social';
import { collectionsService } from '@/services/collections';
import {
  deleteNotification,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '@/services/notifications';
import { getConnectivity } from '@/utils/connectivity';
import { notify } from '@/utils/notify';
import { classifyError, isConnectionError } from '@/utils/networkErrors';
import { snapshotKeys } from '@/utils/offlineSnapshot';
import { parseCollectionItemTarget } from '@/utils/collections';
import {
  enqueueWrite,
  outcomeForFailure,
  parseQueue,
  pendingKey,
  queuedMessage,
  removeWrite,
  type PendingEntry,
  type PendingWrite,
} from '@/utils/pendingWrites';

/**
 * The signed-in user's queue of writes waiting for a connection
 * (utils/pendingWrites.ts). Screens call runOrQueue instead of the service
 * directly and keep their optimistic UI either way; components/
 * PendingWritesSync replays the queue when the connection returns.
 */

async function perform(w: PendingWrite): Promise<void> {
  switch (w.kind) {
    case 'save':
      return w.on ? socialService.saveEvent(w.targetId) : socialService.unsaveEvent(w.targetId);
    case 'follow':
      return w.on ? socialService.followBusiness(w.targetId) : socialService.unfollowBusiness(w.targetId);
    case 'collectionItem': {
      const pair = parseCollectionItemTarget(w.targetId);
      if (!pair) return;
      return w.on
        ? collectionsService.addItem(pair.collectionId, pair.eventId)
        : collectionsService.removeItem(pair.collectionId, pair.eventId);
    }
    case 'notificationRead':
      return w.targetId === '*' ? markAllNotificationsAsRead() : markNotificationAsRead(w.targetId);
    case 'notificationDelete':
      return deleteNotification(w.targetId);
  }
}

let userId: string | null = null;
// False while the session is unverified (stored session, refresh pending):
// requests would wait on the refresh and then go out with the anon key, so
// writes are queued straight away instead. Set by PendingWritesSync, which
// mounts with the app; starting false means a write in the first frames of
// a stale-session start is queued rather than sent with the anon key.
let sessionVerified = false;

export function setPendingWritesSessionVerified(verified: boolean) {
  sessionVerified = verified;
}
let queue: PendingEntry[] = [];
let loaded: Promise<void> = Promise.resolve();
let flushing: Promise<FlushResult> | null = null;
const listeners = new Set<(count: number) => void>();

function save() {
  if (!userId) return;
  const key = snapshotKeys.pendingWrites(userId);
  (queue.length > 0 ? AsyncStorage.setItem(key, JSON.stringify(queue)) : AsyncStorage.removeItem(key)).catch(() => {});
  for (const l of [...listeners]) l(queue.length);
}

/** Switches to `id`'s queue (null on sign-out). Called by PendingWritesSync. */
export function setPendingWritesUser(id: string | null) {
  if (id === userId) return;
  userId = id;
  queue = [];
  for (const l of [...listeners]) l(0);
  if (!id) return;
  loaded = AsyncStorage.getItem(snapshotKeys.pendingWrites(id))
    .then((raw) => {
      if (userId !== id) return;
      queue = parseQueue(raw, Date.now());
      for (const l of [...listeners]) l(queue.length);
    })
    .catch(() => {});
}

export function subscribePendingWrites(listener: (count: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingWriteCount(): number {
  return queue.length;
}

/** The current queue (read-only), e.g. to overlay pending intents on fresh rows. */
export function getPendingWrites(): readonly PendingWrite[] {
  return queue;
}

/**
 * Carries out `write` now, or queues it when there's no connection.
 * Resolves 'done' or 'queued'; rejects only when the server refused it, so
 * the caller rolls back exactly as before. A direct success also clears any
 * older queued intent for the same target.
 */
export async function runOrQueue(write: PendingWrite): Promise<'done' | 'queued'> {
  await loaded;
  // A replay may be sending an older intent for this same target right now.
  // Sending the new one concurrently would let whichever lands last win on
  // the server; wait for the replay so the user's latest intent is applied
  // after it. (Other targets are unaffected.)
  if (flushing && queue.some((e) => pendingKey(e) === pendingKey(write))) {
    await flushing.catch(() => {});
  }
  const queueIt = () => {
    if (!userId) return false;
    queue = enqueueWrite(queue, write, Date.now());
    save();
    return true;
  };
  if ((getConnectivity() === 'offline' || !sessionVerified) && queueIt()) return 'queued';
  try {
    await perform(write);
    const next = removeWrite(queue, write);
    if (next.length !== queue.length) {
      queue = next;
      save();
    }
    return 'done';
  } catch (err) {
    if (isConnectionError(err) && queueIt()) return 'queued';
    throw err;
  }
}

export type FlushResult = { done: PendingWrite[]; dropped: PendingWrite[] };

/**
 * Replays the queue oldest first. Stops at the first connection failure
 * (the rest waits for the next attempt); drops entries the server refuses.
 * Concurrent calls share one run.
 */
export function flushPendingWrites(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    await loaded;
    const owner = userId;
    const result: FlushResult = { done: [], dropped: [] };
    for (const entry of [...queue]) {
      if (userId !== owner || getConnectivity() === 'offline') break;
      // Skip entries replaced while this run was in progress.
      if (!queue.includes(entry)) continue;
      try {
        await perform(entry);
        queue = queue.filter((e) => e !== entry);
        result.done.push(entry);
      } catch (err) {
        const outcome = outcomeForFailure(classifyError(err), entry.attempts);
        if (outcome === 'drop') {
          queue = queue.filter((e) => e !== entry);
          result.dropped.push(entry);
        } else {
          queue = queue.map((e) => (e === entry ? { ...e, attempts: e.attempts + 1 } : e));
          if (isConnectionError(err)) {
            save();
            break;
          }
        }
      }
      save();
    }
    return result;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** runOrQueue, plus the "will sync when you're back online" toast when queued. */
export async function runOrQueueWithNotice(write: PendingWrite): Promise<'done' | 'queued'> {
  const result = await runOrQueue(write);
  if (result === 'queued') {
    const message = queuedMessage(write);
    if (message) notify.success(message);
  }
  return result;
}
