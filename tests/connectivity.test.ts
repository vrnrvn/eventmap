import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RequestTimeoutError,
  classifyError,
  connectionErrorMessage,
  isConnectionError,
  isRetryableError,
  OFFLINE_MESSAGE,
} from '../utils/networkErrors';
import {
  DEGRADED_THRESHOLD,
  FAILURE_WINDOW_MS,
  deriveConnectivityStatus,
  getConnectivity,
  initialConnectivityState,
  isConnectionImpaired,
  reduceConnectivity,
  reportRequestFailed,
  reportRequestSucceeded,
  resetConnectivityForTests,
  setDeviceConnectivity,
  subscribeConnectivity,
} from '../utils/connectivity';
import { createTimeoutFetch, defaultTimeoutFor, DEFAULT_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from '../utils/timeoutFetch';
import { shouldRetryQuery } from '../utils/queryRetry';
import { classifyRsvpError, rsvpErrorMessage, rsvpErrorNeedsRefresh } from '../utils/rsvpErrors';
import { authErrorMessage } from '../utils/authErrors';

/** docs/OFFLINE_PLAN.md step 1: classifier, connectivity store, request layer. */

describe('classifyError', () => {
  it('recognises fetch rejections from every platform', () => {
    for (const message of [
      'Network request failed',
      'Failed to fetch',
      'Load failed',
      'NetworkError when attempting to fetch resource.',
      'The Internet connection appears to be offline.',
    ]) {
      expect(classifyError(new TypeError(message)), message).toBe('network');
    }
  });

  it('recognises postgrest-js network errors (returned, not thrown, with code "")', () => {
    expect(classifyError({ message: 'TypeError: Network request failed', details: 'stack', hint: '', code: '' })).toBe(
      'network'
    );
  });

  it('recognises timeouts from the request layer, raw and as wrapped by postgrest-js', () => {
    expect(classifyError(new RequestTimeoutError(12_000))).toBe('timeout');
    expect(classifyError({ message: 'TimeoutError: Request timed out after 12s', code: '' })).toBe('timeout');
  });

  it('maps AuthRetryableFetchError by status', () => {
    const authErr = (status: number) => Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError', status });
    expect(classifyError(authErr(0))).toBe('network');
    expect(classifyError(authErr(503))).toBe('server');
  });

  it('never blames the connection when the server answered', () => {
    // Server-side text that merely sounds like a connection problem.
    expect(classifyError({ message: 'dial tcp 10.0.0.5:5432: connect: connection refused', status: 500 })).toBe('server');
    expect(classifyError({ message: 'canceling statement due to statement timeout', code: '57014' })).toBe('client');
    expect(classifyError({ message: 'duplicate key', code: '23505' })).toBe('client');
    expect(classifyError({ message: 'EVENT_FULL', code: 'P0001' })).toBe('client');
    expect(classifyError({ message: 'Forbidden', status: 403 })).toBe('client');
  });

  it('treats caller aborts and odd values as unknown', () => {
    expect(classifyError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
    expect(classifyError(undefined)).toBe('unknown');
    expect(classifyError(new Error('Something else'))).toBe('unknown');
  });

  it('derives retry and copy helpers from the class', () => {
    expect(isConnectionError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isConnectionError({ code: '42501', message: 'denied' })).toBe(false);
    expect(isRetryableError({ status: 502, message: 'Bad gateway' })).toBe(true);
    expect(isRetryableError({ status: 400, message: 'Bad request' })).toBe(false);
    expect(connectionErrorMessage(new TypeError('Network request failed'))).toBe(OFFLINE_MESSAGE);
    expect(connectionErrorMessage({ code: '42501' })).toBeNull();
  });
});

describe('connectivity reducer', () => {
  const failAt = (state = initialConnectivityState, ...times: number[]) =>
    times.reduce((s, at) => reduceConnectivity(s, { type: 'requestFailed', at }), state);

  it('is offline whenever the device says so', () => {
    const s = reduceConnectivity(initialConnectivityState, { type: 'device', device: 'offline' });
    expect(deriveConnectivityStatus(s, 0)).toBe('offline');
  });

  it('becomes degraded after repeated failures within the window, and a success clears it', () => {
    const one = failAt(undefined, 1000);
    expect(deriveConnectivityStatus(one, 1000)).toBe('online');
    const two = failAt(one, 2000);
    expect(DEGRADED_THRESHOLD).toBe(2);
    expect(deriveConnectivityStatus(two, 2000)).toBe('degraded');
    expect(deriveConnectivityStatus(reduceConnectivity(two, { type: 'requestSucceeded' }), 2000)).toBe('online');
  });

  it('lets old failures age out of the window', () => {
    const s = failAt(undefined, 0, FAILURE_WINDOW_MS + 1);
    expect(deriveConnectivityStatus(s, FAILURE_WINDOW_MS + 1)).toBe('online');
    expect(s.failures).toHaveLength(1);
  });

  it('starts clean when the device comes back from offline', () => {
    const offline = reduceConnectivity(failAt(undefined, 1, 2), { type: 'device', device: 'offline' });
    const back = reduceConnectivity(offline, { type: 'device', device: 'online' });
    expect(back.failures).toEqual([]);
    expect(deriveConnectivityStatus(back, 3)).toBe('online');
  });

  it('returns the same state object for no-op events (no spurious renders)', () => {
    expect(reduceConnectivity(initialConnectivityState, { type: 'requestSucceeded' })).toBe(initialConnectivityState);
    expect(reduceConnectivity(initialConnectivityState, { type: 'device', device: 'unknown' })).toBe(
      initialConnectivityState
    );
  });
});

describe('connectivity store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetConnectivityForTests();
  });
  afterEach(() => {
    resetConnectivityForTests();
    vi.useRealTimers();
  });

  it('notifies listeners on status changes only', () => {
    const seen: string[] = [];
    subscribeConnectivity((s) => seen.push(s));
    setDeviceConnectivity('online');
    setDeviceConnectivity('offline');
    setDeviceConnectivity('offline');
    setDeviceConnectivity('online');
    expect(seen).toEqual(['offline', 'online']);
  });

  it('drops degraded by itself once the failures age out', () => {
    reportRequestFailed();
    reportRequestFailed();
    expect(getConnectivity()).toBe('degraded');
    expect(isConnectionImpaired()).toBe(true);
    vi.advanceTimersByTime(FAILURE_WINDOW_MS + 5);
    expect(getConnectivity()).toBe('online');
  });

  it('clears degraded on the next successful request', () => {
    reportRequestFailed();
    reportRequestFailed();
    reportRequestSucceeded();
    expect(getConnectivity()).toBe('online');
  });
});

describe('createTimeoutFetch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const ok = () => Promise.resolve(new Response('{}', { status: 200 }));
  /** A fetch that never answers but rejects when aborted, like the real one. */
  const hanging: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
      );
    });

  it('reports success for any HTTP answer, even an error status', async () => {
    const onSuccess = vi.fn();
    const onConnectionFailure = vi.fn();
    const f = createTimeoutFetch({
      baseFetch: () => Promise.resolve(new Response('no', { status: 500 })),
      onSuccess,
      onConnectionFailure,
    });
    const res = await f('https://x.test/rest/v1/events');
    expect(res.status).toBe(500);
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onConnectionFailure).not.toHaveBeenCalled();
  });

  it('times out a request that never answers and reports a connection failure', async () => {
    const onConnectionFailure = vi.fn();
    const f = createTimeoutFetch({ baseFetch: hanging, onConnectionFailure });
    const pending = f('https://x.test/rest/v1/events');
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1);
    await assertion;
    expect(onConnectionFailure).toHaveBeenCalledOnce();
  });

  it('reports network rejections but not other errors', async () => {
    const onConnectionFailure = vi.fn();
    const net = createTimeoutFetch({
      baseFetch: () => Promise.reject(new TypeError('Network request failed')),
      onConnectionFailure,
    });
    await expect(net('https://x.test/a')).rejects.toThrow('Network request failed');
    expect(onConnectionFailure).toHaveBeenCalledOnce();

    const other = createTimeoutFetch({ baseFetch: () => Promise.reject(new Error('boom')), onConnectionFailure });
    await expect(other('https://x.test/a')).rejects.toThrow('boom');
    expect(onConnectionFailure).toHaveBeenCalledOnce();
  });

  it("passes a caller's abort through without reporting it", async () => {
    const onConnectionFailure = vi.fn();
    const f = createTimeoutFetch({ baseFetch: hanging, onConnectionFailure });
    const controller = new AbortController();
    const pending = f('https://x.test/a', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(onConnectionFailure).not.toHaveBeenCalled();
  });

  it('stops the timer once headers arrive', async () => {
    const onConnectionFailure = vi.fn();
    const f = createTimeoutFetch({ baseFetch: ok, onConnectionFailure });
    await f('https://x.test/a');
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS * 2);
    expect(onConnectionFailure).not.toHaveBeenCalled();
  });

  it('gives storage uploads the long limit', () => {
    expect(defaultTimeoutFor('https://x.test/storage/v1/object/event-images/a.jpg', { method: 'POST' })).toBe(
      UPLOAD_TIMEOUT_MS
    );
    expect(defaultTimeoutFor('https://x.test/storage/v1/object/event-images/a.jpg')).toBe(DEFAULT_TIMEOUT_MS);
    expect(defaultTimeoutFor('https://x.test/rest/v1/rpc/get_ranked_events', { method: 'POST' })).toBe(
      DEFAULT_TIMEOUT_MS
    );
  });
});

describe('shouldRetryQuery', () => {
  beforeEach(() => resetConnectivityForTests());
  afterEach(() => resetConnectivityForTests());

  it('retries connection failures and 5xx a bounded number of times', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(1, { status: 503, message: 'unavailable' })).toBe(true);
    expect(shouldRetryQuery(2, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('never retries refusals or timeouts', () => {
    expect(shouldRetryQuery(0, { code: '42501', message: 'denied' })).toBe(false);
    expect(shouldRetryQuery(0, new RequestTimeoutError(12_000))).toBe(false);
  });

  it('does not retry while offline, so the error shows instead of a paused spinner', () => {
    setDeviceConnectivity('offline');
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('connection-aware copy', () => {
  it('RSVP failures caused by the connection say so', () => {
    const offline = classifyRsvpError({ message: 'TypeError: Network request failed', code: '' });
    expect(offline).toBe('OFFLINE');
    expect(rsvpErrorMessage(offline)).toBe(OFFLINE_MESSAGE);
    expect(rsvpErrorNeedsRefresh(offline)).toBe(false);
    const timeout = classifyRsvpError(new RequestTimeoutError(12_000));
    expect(timeout).toBe('TIMEOUT');
    // A timed-out write may have landed: re-read the event.
    expect(rsvpErrorNeedsRefresh(timeout)).toBe(true);
    // Server answers keep their own codes.
    expect(classifyRsvpError({ message: 'EVENT_FULL', code: 'P0001' })).toBe('EVENT_FULL');
  });

  it('auth screens name the connection for retryable fetch errors and timeouts', () => {
    const retryable = Object.assign(new Error('{}'), { name: 'AuthRetryableFetchError', status: 0 });
    expect(authErrorMessage(retryable, 'fallback')).toMatch(/check your connection/i);
    expect(authErrorMessage(new RequestTimeoutError(12_000), 'fallback')).toMatch(/too slow/i);
  });
});
