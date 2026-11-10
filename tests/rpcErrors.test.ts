import { describe, it, expect, vi, beforeEach } from 'vitest';

/** rpcSignatureKey + the session registry of RPCs known missing. */

let m: typeof import('../utils/rpcErrors');
beforeEach(async () => {
  vi.resetModules(); // fresh registry per test
  m = await import('../utils/rpcErrors');
});

describe('rpcSignatureKey', () => {
  it('argument order does not matter', () => {
    expect(m.rpcSignatureKey('f', { b: 1, a: 2, c: 3 })).toBe('f(a,b,c)');
    expect(m.rpcSignatureKey('f', { c: 3, a: 2, b: 1 })).toBe('f(a,b,c)');
  });

  it('undefined args are absent (supabase-js drops them in JSON); null args are PRESENT (sent as null)', () => {
    expect(m.rpcSignatureKey('f', { a: 1, p_ban: undefined })).toBe('f(a)');
    expect(m.rpcSignatureKey('f', { a: 1, p_ban: null })).toBe('f(a,p_ban)');
    expect(m.rpcSignatureKey('f', { a: 1, p_ban: false })).toBe('f(a,p_ban)');
    expect(m.rpcSignatureKey('f', { a: 1, p_ban: 0 })).toBe('f(a,p_ban)');
    expect(m.rpcSignatureKey('f', { a: 1, p_ban: '' })).toBe('f(a,p_ban)');
    // Matches what is actually on the wire.
    expect(Object.keys(JSON.parse(JSON.stringify({ a: 1, x: undefined, y: null })))).toEqual(['a', 'y']);
  });

  it('no args → "f()" (distinct from a bare-name registry entry "f")', () => {
    expect(m.rpcSignatureKey('f', {})).toBe('f()');
    m.markRpcMissing('f');
    expect(m.isRpcKnownMissing(m.rpcSignatureKey('f', {}))).toBe(false);
  });

  it('sorting is by code unit and stable for unusual names', () => {
    expect(m.rpcSignatureKey('f', { B: 1, a: 1, _z: 1, '1': 1 })).toBe('f(1,B,_z,a)');
  });
});

describe('known-missing registry', () => {
  it('a missing NEWER signature does not disable the older one', () => {
    const newer = m.rpcSignatureKey('host_remove_attendee', { p_event_id: 'e', p_user_id: 'u', p_ban: true });
    const older = m.rpcSignatureKey('host_remove_attendee', { p_event_id: 'e', p_user_id: 'u' });
    m.markRpcMissing(newer);
    expect(m.isRpcKnownMissing(newer)).toBe(true);
    expect(m.isRpcKnownMissing(older)).toBe(false);
    // Different values, same names → same signature.
    expect(m.isRpcKnownMissing(m.rpcSignatureKey('host_remove_attendee', { p_user_id: 'x', p_ban: false, p_event_id: 'y' }))).toBe(
      true
    );
  });

  it('isolation between functions and between null/undefined variants', () => {
    m.markRpcMissing(m.rpcSignatureKey('a', { x: null }));
    expect(m.isRpcKnownMissing(m.rpcSignatureKey('a', { x: undefined }))).toBe(false);
    expect(m.isRpcKnownMissing(m.rpcSignatureKey('b', { x: null }))).toBe(false);
    expect(m.isRpcKnownMissing(m.rpcSignatureKey('a', { x: 1 }))).toBe(true);
  });

  it('MISSING_RPC_ERROR satisfies isMissingDbFunction and is frozen', () => {
    expect(m.isMissingDbFunction(m.MISSING_RPC_ERROR)).toBe(true);
    expect(Object.isFrozen(m.MISSING_RPC_ERROR)).toBe(true);
  });

  it('isMissingDbFunction truth table', () => {
    expect(m.isMissingDbFunction(null)).toBe(false);
    expect(m.isMissingDbFunction({})).toBe(false);
    expect(m.isMissingDbFunction({ code: '42883' })).toBe(true);
    expect(m.isMissingDbFunction({ code: 'PGRST202' })).toBe(true);
    expect(m.isMissingDbFunction({ code: '42P01' })).toBe(false);
    expect(m.isMissingDbFunction({ code: 'pgrst202' })).toBe(false);
  });
});

import { recurrenceErrorMessage } from '@/utils/rpcErrors';

describe('recurrenceErrorMessage', () => {
  it('turns the trigger error into host-facing text', () => {
    expect(recurrenceErrorMessage({ message: 'invalid_recurrence: byWeekday must be a non-empty array' })).toBe(
      "This repeat setting isn't valid (byWeekday must be a non-empty array). Open Repeat and adjust it."
    );
    expect(recurrenceErrorMessage(new Error('invalid_recurrence: interval must be a whole number from 1 to 99.'))).toMatch(
      /1 to 99\)/
    );
  });
  it('ignores unrelated errors', () => {
    expect(recurrenceErrorMessage({ message: 'duplicate key' })).toBeNull();
    expect(recurrenceErrorMessage(null)).toBeNull();
    expect(recurrenceErrorMessage(42)).toBeNull();
  });
});
