import { useSyncExternalStore } from 'react';
import { NativeModules, Platform } from 'react-native';
import { onlineManager } from '@tanstack/react-query';
import {
  getConnectivity,
  setDeviceConnectivity,
  subscribeConnectivity,
  type ConnectivityStatus,
  type DeviceConnectivity,
} from '@/utils/connectivity';

/**
 * Feeds the device's connection state into utils/connectivity and connects
 * that store to React Query (docs/OFFLINE_PLAN.md §3.1).
 *
 * NetInfo is a native module. A dev client built before it was added has no
 * RNCNetInfo, and importing the package then throws at load, so it is only
 * required once the native side is known to exist. Without it the store
 * still works from request outcomes alone (degraded, never offline).
 */

type NetInfoState = { isConnected: boolean | null };
type NetInfoModule = {
  configure: (config: Record<string, unknown>) => void;
  addEventListener: (listener: (state: NetInfoState) => void) => () => void;
};

function loadNetInfo(): NetInfoModule | null {
  if (Platform.OS !== 'web' && !NativeModules.RNCNetInfo) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-community/netinfo');
    return (mod.default ?? mod) as NetInfoModule;
  } catch {
    return null;
  }
}

/**
 * Only `isConnected` is trusted. `isInternetReachable` comes from NetInfo's
 * reachability probe, which pings a Google URL every few seconds; that is
 * turned off below (no third-party traffic), and with it off NetInfo reports
 * `false` permanently on iOS and web. "Connected but not working" is caught
 * by request outcomes instead (the degraded status).
 */
export function deviceConnectivityFrom(state: NetInfoState): DeviceConnectivity {
  if (state.isConnected === false) return 'offline';
  if (state.isConnected === true) return 'online';
  return 'unknown';
}

/** Delay before React Query treats the app as back online (see below). */
const RECONNECT_REFETCH_DELAY_MS = 1000;

let started = false;

/** Call once at startup (app/_layout.tsx). Safe to call again. */
export function startConnectivityMonitoring() {
  if (started) return;
  started = true;

  const netInfo = loadNetInfo();
  if (netInfo) {
    netInfo.configure({ reachabilityShouldRun: () => false });
    netInfo.addEventListener((state) => setDeviceConnectivity(deviceConnectivityFrom(state)));
  }

  // React Query pauses retries while "offline" and refetches active queries
  // when the connection returns. Degraded still counts as online: requests
  // may get through, and the timeout bounds the ones that don't.
  //
  // Coming back online is applied after a short delay (going offline is
  // immediate). Reconnecting fires many things at once — the pending-writes
  // flush, the session refresh, context retries, realtime rejoins — and
  // React Query's reconnect refetch of every active query used to land in
  // the same tick, then again after the flushed writes invalidated lists.
  // Letting the writes and session go first means one refetch that already
  // sees the synced state, and a smaller burst on a weak link.
  onlineManager.setEventListener((setOnline) => {
    setOnline(getConnectivity() !== 'offline');
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeConnectivity((status) => {
      if (status === 'offline') {
        if (timer) clearTimeout(timer);
        timer = null;
        setOnline(false);
        return;
      }
      if (onlineManager.isOnline() || timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (getConnectivity() !== 'offline') setOnline(true);
      }, RECONNECT_REFETCH_DELAY_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  });
}

export function useConnectivity(): ConnectivityStatus {
  return useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity);
}
