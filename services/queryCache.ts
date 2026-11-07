import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { dehydrate, type QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore, type Persister } from '@tanstack/react-query-persist-client';
import { snapshotKeys } from '@/utils/offlineSnapshot';
import {
  PERSIST_MAX_AGE_MS,
  PERSIST_THROTTLE_MS,
  cacheBuster,
  isPersistRelevantCacheEvent,
  queriesToTrim,
  serializeForStorage,
  shouldPersistQuery,
} from '@/utils/queryPersistence';

/**
 * Keeps the signed-in user's opted-in queries on the device so lists open
 * with their last data after a restart, offline included
 * (docs/OFFLINE_PLAN.md §3.3). One storage entry per user; removed on
 * sign-out by clearOfflineSnapshots.
 */

const buster = cacheBuster(Constants.expoConfig?.version ?? '0');

/**
 * Starts restoring and saving `userId`'s cache. Returns the restore promise
 * and a stop function. After stop, nothing more is written — including a
 * throttled save already scheduled — so a signed-out user's data can't be
 * written back after it was removed.
 *
 * Saving is wired here rather than through `persistQueryClient`: the
 * library's subscription dehydrates the whole cache synchronously on every
 * query-cache event (each fetch start, observer mount, focus refetch…) for
 * every query, persisted or not, and only throttles the write. Here a save is
 * only *scheduled* when a persisted query's data changes or it is removed,
 * and the dehydrate + serialize runs once when the throttled save fires.
 */
export function startQueryPersistence(queryClient: QueryClient, userId: string) {
  let open = true;
  let restoreDone = false;
  /** Persisted data changed since the last write. */
  let dirty = false;
  let trimming = false;
  let lastWritten: string | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeCache: (() => void) | null = null;

  const key = snapshotKeys.queryCache(userId);
  const dehydrateOptions = {
    shouldDehydrateQuery: shouldPersistQuery,
    shouldDehydrateMutation: () => false,
  };

  // Restore/remove only; saves go through `save` below.
  const persister: Persister = {
    persistClient: () => undefined,
    restoreClient: async () => {
      const raw = await AsyncStorage.getItem(key);
      // Stopped (signed out / switched user) while reading: don't hydrate
      // this user's data into the cache that was just cleared for the next.
      if (!raw || !open) return undefined;
      // Seed the no-op check: an untouched cache needs no rewrite.
      lastWritten = raw;
      return JSON.parse(raw);
    },
    removeClient: () => {
      lastWritten = null;
      return AsyncStorage.removeItem(key);
    },
  };

  const save = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    // Not before the restore finished: that could replace the stored cache
    // with a still-empty one.
    if (!open || !restoreDone || !dirty) return;
    // Drop unobserved over-cap entries from memory first; ignore the
    // 'removed' events this fires (nothing they'd change is stored).
    trimming = true;
    try {
      for (const q of queriesToTrim(queryClient.getQueryCache().getAll())) {
        queryClient.getQueryCache().remove(q);
      }
    } finally {
      trimming = false;
    }
    dirty = false;
    const client = { buster, timestamp: Date.now(), clientState: dehydrate(queryClient, dehydrateOptions) };
    const serialized = serializeForStorage(client);
    // The timestamp is the only part that always changes; compare without it.
    if (lastWritten !== null && sameExceptTimestamp(serialized, lastWritten)) return;
    lastWritten = serialized;
    AsyncStorage.setItem(key, serialized).catch(() => {
      // Retry on the next change rather than losing this one silently.
      dirty = true;
      lastWritten = null;
    });
  };

  const scheduleSave = () => {
    dirty = true;
    if (saveTimer || !open) return;
    saveTimer = setTimeout(save, PERSIST_THROTTLE_MS);
  };

  const restored = persistQueryClientRestore({
    queryClient,
    persister,
    buster,
    maxAge: PERSIST_MAX_AGE_MS,
    // Restored queries stay in memory (and so in storage) until they expire,
    // not just 5 minutes, even if no screen shows them this session.
    hydrateOptions: { defaultOptions: { queries: { gcTime: PERSIST_MAX_AGE_MS } } },
  })
    // A corrupt cache is discarded by the library; startup carries on.
    .catch(() => {})
    .finally(() => {
      restoreDone = true;
      // Subscribe even after a failed restore, so this session's data is
      // still saved (the library's helper skipped saving entirely then).
      if (!open) return;
      unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
        if (!trimming && isPersistRelevantCacheEvent(event)) scheduleSave();
      });
      // Anything that changed while restoring (e.g. a screen's setQueryData).
      scheduleSave();
    });

  // Saves are throttled; write straight away when the app leaves the
  // foreground (or a web tab is hidden), since it may be killed before the
  // throttled save runs. iOS reports `inactive` then `background` for one
  // trip to the home screen; `dirty` makes the second call a no-op, and an
  // `inactive` blip (Control Center, a system alert) only writes if
  // something actually changed.
  // Deferred one tick so screens' own background handlers (e.g. the chat
  // room mirror) have written their last changes into the cache first —
  // this listener is registered at startup, so it would otherwise run first.
  const appState = AppState.addEventListener('change', (state) => {
    if (state !== 'active') setTimeout(save, 0);
  });

  return {
    restored,
    stop: () => {
      open = false;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      appState.remove();
      unsubscribeCache?.();
    },
  };
}

/**
 * Both strings come from serializeForStorage, where the buster and timestamp
 * precede `clientState`; only the timestamp differs between identical saves.
 */
function sameExceptTimestamp(a: string, b: string): boolean {
  const marker = '"clientState":';
  const ia = a.indexOf(marker);
  const ib = b.indexOf(marker);
  if (ia < 0 || ib < 0 || a.length - ia !== b.length - ib) return false;
  return a.slice(ia) === b.slice(ib);
}
