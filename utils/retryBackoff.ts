/**
 * Spacing for automatic background retries of a failed load (profile,
 * business). A real reconnect (offline → online) always retries; the signals
 * that can repeat while a weak link keeps failing — degraded → online flaps,
 * app foregrounds — are spaced out: 5 s, 10 s, 20 s … capped at 2 min.
 * A success resets the gate. Pure module, unit-tested under node.
 */
export type RetryGate = {
  /** Whether an automatic retry may run now; records the attempt if so. */
  tryAcquire: (opts?: { force?: boolean }) => boolean;
  /** The load succeeded: next failure starts from the shortest delay. */
  reset: () => void;
};

export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 120_000;

export function createRetryGate(now: () => number = Date.now): RetryGate {
  let attempts = 0;
  let lastAt = -Infinity;
  return {
    tryAcquire: ({ force = false } = {}) => {
      const wait = Math.min(RETRY_BASE_MS * 2 ** Math.max(attempts - 1, 0), RETRY_MAX_MS);
      if (!force && attempts > 0 && now() - lastAt < wait) return false;
      attempts += 1;
      lastAt = now();
      return true;
    },
    reset: () => {
      attempts = 0;
      lastAt = -Infinity;
    },
  };
}
