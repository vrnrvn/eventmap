/**
 * App-wide connection status (docs/OFFLINE_PLAN.md §3.1). Pure module — no
 * React Native imports — so it is unit-tested under node and can be read
 * from anywhere (notify, services, React Query's onlineManager).
 *
 * Two inputs feed it:
 * - the device's own view (NetInfo on native, navigator.onLine on web), via
 *   setDeviceConnectivity — see services/connectivity.ts
 * - the outcome of every backend request (services/supabase.ts), which
 *   catches what the device can't see: captive portals, one-bar signal, a
 *   connection that is "up" but drops everything
 *
 * Statuses:
 * - offline:  the device reports no connection
 * - degraded: the device says connected, but recent requests keep failing
 *             or timing out (DEGRADED_THRESHOLD within FAILURE_WINDOW_MS,
 *             with no success since)
 * - online:   everything else, including "unknown" device state
 */

export type ConnectivityStatus = 'online' | 'offline' | 'degraded';
export type DeviceConnectivity = 'online' | 'offline' | 'unknown';

export const FAILURE_WINDOW_MS = 30_000;
export const DEGRADED_THRESHOLD = 2;

export type ConnectivityState = {
  device: DeviceConnectivity;
  /** Timestamps of connection failures since the last successful request. */
  failures: number[];
};

export type ConnectivityEvent =
  | { type: 'device'; device: DeviceConnectivity }
  | { type: 'requestSucceeded' }
  | { type: 'requestFailed'; at: number };

export const initialConnectivityState: ConnectivityState = { device: 'unknown', failures: [] };

export function reduceConnectivity(state: ConnectivityState, event: ConnectivityEvent): ConnectivityState {
  switch (event.type) {
    case 'device':
      if (event.device === state.device) return state;
      // Coming back from offline starts clean: failures recorded while the
      // radio was off say nothing about the new connection.
      return {
        device: event.device,
        failures: state.device === 'offline' && event.device !== 'offline' ? [] : state.failures,
      };
    case 'requestSucceeded':
      return state.failures.length === 0 ? state : { ...state, failures: [] };
    case 'requestFailed':
      return {
        ...state,
        // Keep only what can still count, so the list can't grow unbounded.
        failures: [...state.failures.filter((t) => event.at - t < FAILURE_WINDOW_MS), event.at],
      };
  }
}

export function deriveConnectivityStatus(state: ConnectivityState, now: number): ConnectivityStatus {
  if (state.device === 'offline') return 'offline';
  const recent = state.failures.filter((t) => now - t < FAILURE_WINDOW_MS).length;
  return recent >= DEGRADED_THRESHOLD ? 'degraded' : 'online';
}

/** When a degraded status will lapse on its own (oldest counted failure ages out). */
function nextExpiry(state: ConnectivityState, now: number): number | null {
  const recent = state.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
  if (recent.length < DEGRADED_THRESHOLD) return null;
  // Status drops below the threshold once all but (threshold - 1) age out.
  const pivot = recent[recent.length - DEGRADED_THRESHOLD];
  return pivot + FAILURE_WINDOW_MS - now;
}

// ── Store ───────────────────────────────────────────────────────────────────

type Listener = (status: ConnectivityStatus) => void;

let state = initialConnectivityState;
let status: ConnectivityStatus = 'online';
const listeners = new Set<Listener>();
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function publish() {
  const now = Date.now();
  const next = deriveConnectivityStatus(state, now);
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  const expiresIn = nextExpiry(state, now);
  if (expiresIn !== null) expiryTimer = setTimeout(publish, expiresIn + 1);
  if (next === status) return;
  status = next;
  for (const listener of [...listeners]) listener(status);
}

function dispatch(event: ConnectivityEvent) {
  const next = reduceConnectivity(state, event);
  if (next === state) return;
  state = next;
  publish();
}

export function getConnectivity(): ConnectivityStatus {
  return status;
}

/** True while the connection is offline or failing: background errors are expected. */
export function isConnectionImpaired(): boolean {
  return status !== 'online';
}

export function subscribeConnectivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDeviceConnectivity(device: DeviceConnectivity) {
  dispatch({ type: 'device', device });
}

export function reportRequestSucceeded() {
  dispatch({ type: 'requestSucceeded' });
}

/** A request failed because of the connection (network error or timeout). */
export function reportRequestFailed() {
  dispatch({ type: 'requestFailed', at: Date.now() });
}

/** Test helper: back to the initial state with no listeners. */
export function resetConnectivityForTests() {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  state = initialConnectivityState;
  status = 'online';
  listeners.clear();
}
