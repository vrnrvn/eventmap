import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { onlineManager as OnlineManager } from '@tanstack/react-query';
import { createRequire } from 'node:module';
import { DEGRADED_THRESHOLD } from '../utils/connectivity';

/**
 * services/connectivity.ts → React Query onlineManager: offline applies at
 * once, online only after the 1 s reconnect delay, and a flap back to
 * offline inside the delay never lets "online" through.
 *
 * NetInfo is mocked; the service `require`s it lazily only when the native
 * module exists, so `NativeModules.RNCNetInfo` is provided. Whether the
 * mocked module or nothing is picked up, the store is driven directly through
 * utils/connectivity (exactly what the NetInfo listener calls).
 */

const netinfo = vi.hoisted(() => ({
  configure: vi.fn(),
  listener: null as null | ((s: { isConnected: boolean | null }) => void),
  addEventListener: vi.fn(),
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (s: Record<string, unknown>) => s.ios ?? s.default },
  NativeModules: { RNCNetInfo: {} },
}));
vi.mock('@react-native-community/netinfo', () => ({ default: netinfo }));
// The service loads NetInfo with a lazy CommonJS `require`, which bypasses
// vi.mock; seed Node's require cache so that `require` returns the mock too.
{
  const req = createRequire(import.meta.url);
  const resolved = req.resolve('@react-native-community/netinfo');
  req.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { default: netinfo } } as NodeJS.Module;
}

const DELAY = 1000;

// Each test gets a fresh module graph (the service's `started` flag), so
// the store and onlineManager must come from the SAME registry as the service.
let store: typeof import('../utils/connectivity');
let onlineManager: typeof OnlineManager;

async function start() {
  vi.resetModules();
  store = await import('../utils/connectivity');
  onlineManager = (await import('@tanstack/react-query')).onlineManager;
  const mod = await import('../services/connectivity');
  return mod;
}

const goOffline = () => store.setDeviceConnectivity('offline');
const goOnline = () => store.setDeviceConnectivity('online');
const getConnectivity = () => store.getConnectivity();
const reportRequestSucceeded = () => store.reportRequestSucceeded();
function goDegraded() {
  for (let i = 0; i < DEGRADED_THRESHOLD; i++) store.reportRequestFailed();
}

let changes: boolean[] = [];
let unsubscribe: () => void = () => {};

beforeEach(async () => {
  vi.useFakeTimers();
  svc = await start();
  netinfo.addEventListener.mockImplementation((l) => {
    netinfo.listener = l;
    return () => {};
  });
  changes = [];
});

afterEach(() => {
  unsubscribe();
  // Detach our listener so other files start from a clean manager.
  onlineManager.setEventListener(() => () => {});
  onlineManager.setOnline(true);
  store.resetConnectivityForTests();
  vi.useRealTimers();
});

let svc: Awaited<ReturnType<typeof start>>;

async function startObserved() {
  svc.startConnectivityMonitoring();
  unsubscribe = onlineManager.subscribe((online) => changes.push(online));
}

describe('connectivity → onlineManager', () => {
  it('initial state is applied synchronously from the store', async () => {
    goOffline();
    await startObserved();
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('offline is applied immediately', async () => {
    await startObserved();
    expect(onlineManager.isOnline()).toBe(true);
    goOffline();
    expect(onlineManager.isOnline()).toBe(false);
    expect(changes).toEqual([false]);
  });

  it('online is applied only after the 1 s delay', async () => {
    goOffline();
    await startObserved();
    goOnline();
    expect(getConnectivity()).toBe('online');
    expect(onlineManager.isOnline()).toBe(false);
    await vi.advanceTimersByTimeAsync(DELAY - 1);
    expect(onlineManager.isOnline()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(onlineManager.isOnline()).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('flapping online → offline within the delay never sets online', async () => {
    goOffline();
    await startObserved();
    for (let i = 0; i < 20; i++) {
      goOnline();
      await vi.advanceTimersByTimeAsync(DELAY / 2);
      goOffline();
      await vi.advanceTimersByTimeAsync(DELAY / 4);
    }
    await vi.advanceTimersByTimeAsync(5 * DELAY);
    expect(onlineManager.isOnline()).toBe(false);
    expect(changes).not.toContain(true);
  });

  it('a timer started before a flap does not fire early after the flap (delay restarts)', async () => {
    goOffline();
    await startObserved();
    goOnline();
    await vi.advanceTimersByTimeAsync(900);
    goOffline();
    goOnline(); // new 1 s window starts here
    await vi.advanceTimersByTimeAsync(200); // 1.1 s after the first "online"
    expect(onlineManager.isOnline()).toBe(false);
    await vi.advanceTimersByTimeAsync(800);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('degraded counts as online after the delay (offline → degraded)', async () => {
    goOffline();
    await startObserved();
    goOnline();
    goDegraded();
    expect(getConnectivity()).toBe('degraded');
    expect(onlineManager.isOnline()).toBe(false);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('online ↔ degraded churn while already online never toggles the manager', async () => {
    await startObserved();
    for (let i = 0; i < 10; i++) {
      goDegraded();
      reportRequestSucceeded();
    }
    await vi.advanceTimersByTimeAsync(5 * DELAY);
    expect(changes).toEqual([]);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('startConnectivityMonitoring is idempotent; replacing the listener clears a pending timer', async () => {
    svc.startConnectivityMonitoring();
    svc.startConnectivityMonitoring();
    svc.startConnectivityMonitoring();
    goOffline();
    goOnline(); // timer pending
    onlineManager.setEventListener(() => () => {}); // cleanup of ours runs
    onlineManager.setOnline(false);
    await vi.advanceTimersByTimeAsync(5 * DELAY);
    expect(onlineManager.isOnline()).toBe(false); // our timer did not fire setOnline(true)
  });

  it('without the native module (old dev client) NetInfo is never required; store still drives the manager', async () => {
    const rn = await import('react-native');
    const saved = (rn.NativeModules as Record<string, unknown>).RNCNetInfo;
    delete (rn.NativeModules as Record<string, unknown>).RNCNetInfo;
    try {
      netinfo.addEventListener.mockClear();
      await startObserved();
      expect(netinfo.addEventListener).not.toHaveBeenCalled();
      goOffline();
      expect(onlineManager.isOnline()).toBe(false);
    } finally {
      (rn.NativeModules as Record<string, unknown>).RNCNetInfo = saved;
    }
  });

  it('NetInfo events feed the store and the manager; reachability probe disabled', async () => {
    await startObserved();
    expect(netinfo.listener).toBeTypeOf('function');
    const emit = netinfo.listener!;
    const config = netinfo.configure.mock.calls.at(-1)![0] as { reachabilityShouldRun: () => boolean };
    expect(config.reachabilityShouldRun()).toBe(false);
    emit({ isConnected: false });
    expect(onlineManager.isOnline()).toBe(false);
    emit({ isConnected: true });
    expect(onlineManager.isOnline()).toBe(false);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(onlineManager.isOnline()).toBe(true);
    // `null` (unknown) is not offline: stays online.
    emit({ isConnected: null });
    expect(onlineManager.isOnline()).toBe(true);
  });
});
