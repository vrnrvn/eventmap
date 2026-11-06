import { describe, it, expect } from 'vitest';
import {
  SNAPSHOT_VERSION,
  isBusinessSnapshot,
  isProfileSnapshot,
  parseSnapshot,
  parseStoredSession,
  serializeSnapshot,
  snapshotKeys,
} from '../utils/offlineSnapshot';

/** docs/OFFLINE_PLAN.md step 2: device snapshots and the stored session. */

type P = { id: string; name: string; has_completed_onboarding?: boolean };
type B = { id: string; owner_id: string; name: string };

const profile = (over: Partial<P> = {}): P => ({ id: 'u1', name: 'Ada', has_completed_onboarding: true, ...over });

describe('profile snapshots', () => {
  const valid = isProfileSnapshot<P>('u1');

  it('round-trips an onboarded profile for the same user', () => {
    const raw = serializeSnapshot('u1', { profile: profile(), isBanned: false }, 1234);
    expect(parseSnapshot(raw, 'u1', valid)).toEqual({ data: { profile: profile(), isBanned: false }, savedAt: 1234 });
  });

  it('never returns another user’s snapshot', () => {
    const raw = serializeSnapshot('u2', { profile: profile({ id: 'u2' }), isBanned: false });
    expect(parseSnapshot(raw, 'u1', valid)).toBeUndefined();
    // Envelope owner matches but the profile inside belongs to someone else.
    const mixed = serializeSnapshot('u1', { profile: profile({ id: 'u2' }), isBanned: false });
    expect(parseSnapshot(mixed, 'u1', valid)).toBeUndefined();
  });

  it('ignores un-onboarded profiles (would route into onboarding)', () => {
    const raw = serializeSnapshot('u1', { profile: profile({ has_completed_onboarding: false }), isBanned: false });
    expect(parseSnapshot(raw, 'u1', valid)).toBeUndefined();
  });

  it('ignores other versions, malformed JSON and missing fields', () => {
    const old = JSON.stringify({ v: SNAPSHOT_VERSION - 1, owner: 'u1', savedAt: 1, data: { profile: profile(), isBanned: false } });
    expect(parseSnapshot(old, 'u1', valid)).toBeUndefined();
    expect(parseSnapshot('{not json', 'u1', valid)).toBeUndefined();
    expect(parseSnapshot(null, 'u1', valid)).toBeUndefined();
    expect(parseSnapshot(serializeSnapshot('u1', { profile: profile() }), 'u1', valid)).toBeUndefined();
  });
});

describe('business snapshots', () => {
  const valid = isBusinessSnapshot<B>('u1');

  it('distinguishes "no business" (null) from "no snapshot"', () => {
    expect(parseSnapshot(serializeSnapshot('u1', { business: null }), 'u1', valid)?.data).toEqual({ business: null });
    expect(parseSnapshot(null, 'u1', valid)).toBeUndefined();
  });

  it('rejects a business owned by someone else', () => {
    const raw = serializeSnapshot('u1', { business: { id: 'b1', owner_id: 'u2', name: 'X' } });
    expect(parseSnapshot(raw, 'u1', valid)).toBeUndefined();
    const ok = serializeSnapshot('u1', { business: { id: 'b1', owner_id: 'u1', name: 'X' } });
    expect(parseSnapshot(ok, 'u1', valid)?.data.business?.id).toBe('b1');
  });

  it('keys snapshots per user / business', () => {
    expect(snapshotKeys.profile('u1')).not.toBe(snapshotKeys.profile('u2'));
    expect(snapshotKeys.business('u1')).toContain('u1');
    expect(snapshotKeys.premium('b1')).toContain('b1');
  });
});

describe('parseStoredSession', () => {
  const session = { access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'u1', email: 'x@y.z' } };

  it('reads the session object supabase-js persists', () => {
    expect(parseStoredSession(JSON.stringify(session))?.user.id).toBe('u1');
  });

  it('reads the legacy { currentSession } wrapper', () => {
    expect(parseStoredSession(JSON.stringify({ currentSession: session, expiresAt: 1 }))?.user.id).toBe('u1');
  });

  it('rejects anything that could not be renewed or identified', () => {
    expect(parseStoredSession(null)).toBeNull();
    expect(parseStoredSession('garbage')).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...session, refresh_token: '' }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...session, access_token: undefined }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...session, user: {} }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...session, user: null }))).toBeNull();
  });
});
