/**
 * The mapper's contract is twofold: recognised failures get actionable copy,
 * and *unrecognised* Supabase errors never reach the user verbatim (they leak
 * internal phrasing, SQL, and stack detail).
 */
import { describe, it, expect } from 'vitest';
import { authErrorMessage } from '@/utils/authErrors';

const FALLBACK = 'Something went wrong. Please try again.';
const supa = (message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { name: 'AuthApiError', status: 400, ...extra });

describe('never leaks server internals', () => {
  it('falls back for anything that looks like infrastructure', () => {
    const leaky = [
      'pq: duplicate key value violates unique constraint "users_pkey"',
      'ERROR: relation "auth.users" does not exist (SQLSTATE 42P01)',
      'dial tcp 10.0.0.5:5432: connect: connection refused',
      'panic: runtime error: invalid memory address or nil pointer dereference',
      'goroutine 42 [running]: github.com/supabase/gotrue/internal/api.(*API).Token',
      'Internal Server Error',
      'failed to parse JWT: signature is invalid',
      '<html><head><title>502 Bad Gateway</title></head></html>',
      'x-request-id: 8f3a2b1c-dead-beef',
      'unexpected_failure',
    ];
    for (const message of leaky) {
      const out = authErrorMessage(supa(message, { status: 500 }), FALLBACK);
      expect(out, message.slice(0, 40)).toBe(FALLBACK);
      expect(out).not.toContain('pq:');
      expect(out).not.toContain('SQLSTATE');
      expect(out).not.toContain('goroutine');
    }
  });

  it('never returns an empty or whitespace-only message', () => {
    for (const e of [supa(''), supa('   '), supa('\n'), {}, null, undefined, new Error('')]) {
      const out = authErrorMessage(e, FALLBACK);
      expect(out.trim().length).toBeGreaterThan(0);
    }
  });

  it('does not echo a raw AuthApiError even when short', () => {
    expect(authErrorMessage(supa('bad_jwt'), FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage(supa('conflict'), FALLBACK)).toBe(FALLBACK);
  });
});

describe('recognises the GoTrue failures users actually hit', () => {
  const cases: [string, RegExp][] = [
    ['Invalid login credentials', /email or password/i],
    ['Email not confirmed', /confirm your email/i],
    ['User already registered', /already exists/i],
    ['A user with this email address has already been registered', /already exists/i],
    ['Password should be at least 8 characters', /at least 8 characters/i],
    ['Signup requires a valid password', /./],
    ['For security purposes, you can only request this after 54 seconds', /wait a minute/i],
    ['Email rate limit exceeded', /wait a minute/i],
    ['Token has expired or is invalid', /expired/i],
    ['Email link is invalid or has expired', /expired/i],
    ['Signups not allowed for this instance', /disabled/i],
    ['User not found', /no account/i],
    ['New password should be different from the old password', /different/i],
  ];

  it('maps each to actionable copy', () => {
    for (const [raw, expected] of cases) {
      expect(authErrorMessage(supa(raw), FALLBACK), raw).toMatch(expected);
    }
  });

  it('matches regardless of casing', () => {
    expect(authErrorMessage(supa('INVALID LOGIN CREDENTIALS'), FALLBACK)).toMatch(/email or password/i);
    expect(authErrorMessage(supa('invalid login credentials'), FALLBACK)).toMatch(/email or password/i);
  });

  it('matches the underscored machine codes as well as the prose', () => {
    // GoTrue sends `weak_password` as a code and "Password is too weak" as
    // prose for the same condition; both must map.
    const codes = [
      'otp_expired',
      'over_email_send_rate_limit',
      'over_request_rate_limit',
      'weak_password',
      'email_not_confirmed',
      'user_already_exists',
      'email_exists',
      'invalid_credentials',
      'same_password',
      'signup_disabled',
      'user_not_found',
      'session_expired',
    ];
    for (const code of codes) {
      expect(authErrorMessage({ code }, FALLBACK), code).not.toBe(FALLBACK);
    }
  });
});

describe('preserves our own copy', () => {
  it('passes through plain Errors thrown by services/auth.ts', () => {
    for (const message of [
      'Social sign-in is not configured. Please sign in with email.',
      'Google Play Services not available',
      'Sign in already in progress',
      'This account has no email to verify against. Sign in again and retry.',
    ]) {
      expect(authErrorMessage(new Error(message), FALLBACK), message).toBe(message);
    }
  });

  it('still maps our cancellation message', () => {
    expect(authErrorMessage(new Error('OAuth was cancelled or failed'), FALLBACK)).toMatch(
      /cancelled/i
    );
  });
});

describe('robustness', () => {
  it('handles odd shapes without throwing', () => {
    const odd = [
      null,
      undefined,
      0,
      '',
      'a string error',
      { message: 123 },
      { message: null },
      { code: 123 },
      { message: { nested: true } },
      [],
      Symbol('x'),
      new Error('x'),
    ];
    for (const e of odd) {
      expect(() => authErrorMessage(e, FALLBACK), String(String(e).slice(0, 20))).not.toThrow();
      expect(typeof authErrorMessage(e, FALLBACK)).toBe('string');
    }
  });

  it('handles a very long message', () => {
    const out = authErrorMessage(supa('x'.repeat(100000)), FALLBACK);
    expect(out).toBe(FALLBACK);
  });

  it('is deterministic', () => {
    const e = supa('Invalid login credentials');
    expect(authErrorMessage(e, FALLBACK)).toBe(authErrorMessage(e, FALLBACK));
  });
});
