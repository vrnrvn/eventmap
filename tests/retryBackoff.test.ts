import { describe, it, expect } from 'vitest';
import { createRetryGate, RETRY_MAX_MS } from '../utils/retryBackoff';

describe('createRetryGate', () => {
  it('allows the first retry, then spaces them out exponentially', () => {
    let t = 0;
    const gate = createRetryGate(() => t);
    expect(gate.tryAcquire()).toBe(true); // attempt 1
    t = 4_000;
    expect(gate.tryAcquire()).toBe(false); // < 5 s
    t = 5_000;
    expect(gate.tryAcquire()).toBe(true); // attempt 2
    t = 14_000;
    expect(gate.tryAcquire()).toBe(false); // < 10 s since last
    t = 15_000;
    expect(gate.tryAcquire()).toBe(true); // attempt 3
  });

  it('caps the delay and lets a real reconnect force through', () => {
    let t = 0;
    const gate = createRetryGate(() => t);
    for (let i = 0; i < 20; i++) {
      t += RETRY_MAX_MS;
      expect(gate.tryAcquire()).toBe(true);
    }
    t += 1;
    expect(gate.tryAcquire()).toBe(false);
    expect(gate.tryAcquire({ force: true })).toBe(true);
  });

  it('reset starts over', () => {
    let t = 0;
    const gate = createRetryGate(() => t);
    gate.tryAcquire();
    gate.tryAcquire({ force: true });
    gate.reset();
    t = 1;
    expect(gate.tryAcquire()).toBe(true);
  });
});
