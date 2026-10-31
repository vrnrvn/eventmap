import { describe, it, expect } from 'vitest';
import { authErrorMessage } from '@/utils/authErrors';

const FALLBACK = 'Sign in failed. Please try again.';

/** Shapes supabase-js actually throws. */
const supabaseError = (message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { name: 'AuthApiError', status: 400, ...extra });

describe('authErrorMessage', () => {
  it('rewrites the common GoTrue failures into actionable copy', () => {
    const cases: [string, RegExp][] = [
      ['Invalid login credentials', /email or password is not right/i],
      ['Email not confirmed', /confirm your email/i],
      ['User already registered', /already exists/i],
      ['Password should be at least 8 characters', /at least 8 characters/i],
      ['Email link is invalid or has expired', /expired/i],
      ['For security purposes, you can only request this after 60 seconds', /wait a minute/i],
    ];
    for (const [raw, expected] of cases) {
      expect(authErrorMessage(supabaseError(raw), FALLBACK), raw).toMatch(expected);
    }
  });

  it('never leaks an unrecognised Supabase message', () => {
    const leaky = supabaseError('pq: duplicate key value violates unique constraint "users_pkey"');
    expect(authErrorMessage(leaky, FALLBACK)).toBe(FALLBACK);

    const internal = supabaseError('Internal Server Error: panic in goroutine 42', { status: 500 });
    expect(authErrorMessage(internal, FALLBACK)).toBe(FALLBACK);
  });

  it('keeps our own user-facing messages', () => {
    // services/auth.ts throws plain Errors with copy already written for users.
    const ours = new Error('Social sign-in is not configured. Please sign in with email.');
    expect(authErrorMessage(ours, FALLBACK)).toBe(ours.message);
  });

  it('matches on the error code as well as the message', () => {
    expect(authErrorMessage({ code: 'otp_expired' }, FALLBACK)).toMatch(/expired/i);
    expect(authErrorMessage({ code: 'over_email_send_rate_limit' }, FALLBACK)).toMatch(/wait a minute/i);
  });

  it('handles cancellation and offline cases', () => {
    expect(authErrorMessage(new Error('OAuth was cancelled or failed'), FALLBACK)).toMatch(/cancelled/i);
    expect(authErrorMessage(new Error('Network request failed'), FALLBACK)).toMatch(/connection/i);
  });

  it('falls back for absent or empty errors', () => {
    expect(authErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage({}, FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage(supabaseError(''), FALLBACK)).toBe(FALLBACK);
  });

  it('prefers the more specific pattern when several could match', () => {
    // "Password should be at least 8 characters" also contains "password";
    // the length-specific message must win.
    expect(authErrorMessage(supabaseError('Password should be at least 8 characters'), FALLBACK)).toMatch(
      /at least 8 characters/i
    );
  });
});
