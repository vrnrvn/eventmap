import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { dehydrate, type QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { snapshotKeys } from '@/utils/offlineSnapshot';
import {
  PERSIST_MAX_AGE_MS,
  PERSIST_THROTTLE_MS,
  cacheBuster,
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
 */
export function startQueryPersistence(queryClient: QueryClient, userId: string) {
  let open = true;
  let restoreDone = false;
  const key = snapshotKeys.queryCache(userId);
  const dehydrateOptions = {
    shouldDehydrateQuery: shouldPersistQuery,
    shouldDehydrateMutation: () => false,
  };
  const persister = createAsyncStoragePersister({
    key,
    throttleTime: PERSIST_THROTTLE_MS,
    serialize: (client) => serializeForStorage(client),
    storage: {
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => (open ? AsyncStorage.setItem(key, value) : Promise.resolve()),
      removeItem: (key) => AsyncStorage.removeItem(key),
    },
  });
  const [unsubscribe, restored] = persistQueryClient({
    queryClient,
    persister,
    buster,
    maxAge: PERSIST_MAX_AGE_MS,
    // Restored queries stay in memory (and so in storage) until they expire,
    // not just 5 minutes, even if no screen shows them this session.
    hydrateOptions: { defaultOptions: { queries: { gcTime: PERSIST_MAX_AGE_MS } } },
    dehydrateOptions,
  });

  // Saves are throttled (2 s); write straight away when the app is
  // backgrounded (or a web tab hidden), since it may be killed before the
  // throttled save runs. Not before the restore finished: that could
  // replace the stored cache with a still-empty one.
  const flush = () => {
    if (!open || !restoreDone) return;
    const client = { buster, timestamp: Date.now(), clientState: dehydrate(queryClient, dehydrateOptions) };
    AsyncStorage.setItem(key, serializeForStorage(client)).catch(() => {});
  };
  const appState = AppState.addEventListener('change', (state) => {
    if (state !== 'active') flush();
  });

  return {
    // A corrupt cache is discarded by the library; startup carries on.
    restored: restored.catch(() => {}).finally(() => {
      restoreDone = true;
    }),
    stop: () => {
      open = false;
      appState.remove();
      unsubscribe();
    },
  };
}
