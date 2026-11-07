import { describe, it, expect } from 'vitest';
import { RETRY_BASE_MS, RETRY_MAX_MS, createRetryGate } from '../utils/retryBackoff';

/** Long random tryAcquire / force / reset sequences against a fake clock. */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Backoff that must separate the next non-forced acquisition from the last one, after `attempts` acquisitions. */
const backoffAfter = (attempts: number) => Math.min(RETRY_BASE_MS * 2 ** Math.max(attempts - 1, 0), RETRY_MAX_MS);

describe('createRetryGate — properties', () => {
  it('random sequences: spacing invariant, cap, reset, forced always passes (model-checked)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = mulberry32(seed);
      let clock = 1_700_000_000_000;
      const gate = createRetryGate(() => clock);
      // Model
      let attempts = 0;
      let lastAt: number | null = null;
      let maxObservedWait = 0;

      for (let step = 0; step < 2_000; step++) {
        // Advance the clock by a mix of tiny, medium and huge jumps (incl. 0).
        const k = r();
        clock += k < 0.3 ? 0 : k < 0.6 ? Math.floor(r() * 2_000) : k < 0.9 ? Math.floor(r() * 40_000) : Math.floor(r() * 300_000);
        const op = r();
        const msg = `seed=${seed} step=${step}`;
        if (op < 0.05) {
          gate.reset();
          attempts = 0;
          lastAt = null;
        } else if (op < 0.15) {
          expect(gate.tryAcquire({ force: true }), msg).toBe(true);
          attempts++;
          lastAt = clock;
        } else {
          const ok = gate.tryAcquire();
          const wait = backoffAfter(attempts);
          const expected = attempts === 0 || lastAt === null || clock - lastAt >= wait;
          expect(ok, `${msg} attempts=${attempts} since=${lastAt === null ? '∞' : clock - lastAt} wait=${wait}`).toBe(
            expected
          );
          if (ok) {
            // Invariant: a non-forced acquisition is never closer than the current backoff.
            if (attempts > 0 && lastAt !== null) expect(clock - lastAt, msg).toBeGreaterThanOrEqual(wait);
            maxObservedWait = Math.max(maxObservedWait, wait);
            attempts++;
            lastAt = clock;
          }
        }
        expect(backoffAfter(attempts)).toBeLessThanOrEqual(RETRY_MAX_MS);
      }
      expect(maxObservedWait).toBeLessThanOrEqual(RETRY_MAX_MS);
    }
  });

  it('delay schedule: 5 s, 10 s, 20 s … capped at RETRY_MAX_MS, also after 10,000 attempts (no overflow/NaN)', () => {
    let clock = 0;
    const gate = createRetryGate(() => clock);
    expect(gate.tryAcquire()).toBe(true); // first attempt is free
    const waits: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      // Find the exact moment the gate opens.
      const wait = backoffAfter(i + 1);
      clock += wait - 1;
      expect(gate.tryAcquire(), `attempt ${i + 2} at wait-1`).toBe(false);
      clock += 1;
      expect(gate.tryAcquire(), `attempt ${i + 2} at wait`).toBe(true);
      waits.push(wait);
    }
    expect(waits.slice(0, 6)).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 120_000]);
    expect(waits.at(-1)).toBe(RETRY_MAX_MS);
  });

  it('reset restores 0 attempts: the very next call passes, then the shortest delay applies', () => {
    let clock = 0;
    const gate = createRetryGate(() => clock);
    for (let i = 0; i < 20; i++) gate.tryAcquire({ force: true });
    expect(gate.tryAcquire()).toBe(false);
    gate.reset();
    expect(gate.tryAcquire()).toBe(true);
    clock += RETRY_BASE_MS - 1;
    expect(gate.tryAcquire()).toBe(false);
    clock += 1;
    expect(gate.tryAcquire()).toBe(true);
  });

  it('forced acquisitions count as attempts and restart the wait', () => {
    let clock = 0;
    const gate = createRetryGate(() => clock);
    gate.tryAcquire();
    clock += 4_999;
    expect(gate.tryAcquire({ force: true })).toBe(true); // attempts=2, lastAt=4999
    clock += 9_999;
    expect(gate.tryAcquire()).toBe(false); // needs 10 s since the forced one
    clock += 1;
    expect(gate.tryAcquire()).toBe(true);
  });

  it('a clock that jumps backwards keeps the gate closed until it catches up (documented)', () => {
    let clock = 1_000_000;
    const gate = createRetryGate(() => clock);
    gate.tryAcquire();
    clock -= 60_000; // device time set back
    expect(gate.tryAcquire()).toBe(false);
    clock = 1_000_000 + RETRY_BASE_MS;
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire({ force: true })).toBe(true); // force still escapes
  });

  it('default clock is Date.now', () => {
    const gate = createRetryGate();
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
  });
});
