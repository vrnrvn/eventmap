import { describe, it, expect, vi } from 'vitest';

/**
 * Loads services/pendingWrites in a fresh module (its own test file) so the
 * module-level default is what is under test: before PendingWritesSync has
 * reported the session state, a write must be queued, not sent. Sending it
 * during a stale-session start would wait on the token refresh and then go
 * out with the anon key.
 */
const calls: string[] = [];
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock('@/services/social', () => ({
  socialService: { saveEvent: async (id: string) => void calls.push(`save:${id}`) },
}));
vi.mock('@/services/notifications', () => ({}));

describe('pendingWrites initial state', () => {
  it('treats the session as unverified until PendingWritesSync says otherwise', async () => {
    const pw = await import('../services/pendingWrites');
    pw.setPendingWritesUser('u1');
    expect(await pw.runOrQueue({ kind: 'save', targetId: 'e1', on: true })).toBe('queued');
    expect(calls).toEqual([]);
    pw.setPendingWritesSessionVerified(true);
    expect(await pw.runOrQueue({ kind: 'save', targetId: 'e2', on: true })).toBe('done');
    expect(calls).toEqual(['save:e2']);
  });
});
