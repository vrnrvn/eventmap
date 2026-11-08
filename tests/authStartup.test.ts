import { describe, it, expect } from 'vitest';
import { classifyRefreshFailure, startupActionForRefreshFailure } from '../utils/authStartup';

// Shapes copied from auth-js 2.98 (lib/errors.js, lib/fetch.js): the name is
// what distinguishes the classes once they cross a module boundary.
const authApi = (status: number, code?: string, message = 'error') => ({ name: 'AuthApiError', status, code, message });
const retryable = (status: number) => ({ name: 'AuthRetryableFetchError', status, message: 'fetch failed' });
const unknown = () => ({ name: 'AuthUnknownError', message: 'Unexpected token < in JSON', originalError: new SyntaxError() });

describe('classifyRefreshFailure', () => {
  it('rejects only when the server says the token is dead', () => {
    expect(classifyRefreshFailure(authApi(400, 'invalid_grant'))).toBe('rejected');
    expect(classifyRefreshFailure(authApi(400, 'refresh_token_not_found'))).toBe('rejected');
    expect(classifyRefreshFailure(authApi(400, 'refresh_token_already_used'))).toBe('rejected');
    expect(classifyRefreshFailure(authApi(401))).toBe('rejected');
    expect(classifyRefreshFailure(authApi(403, 'user_banned'))).toBe('rejected');
    expect(classifyRefreshFailure(authApi(404, 'user_not_found'))).toBe('rejected');
    expect(classifyRefreshFailure({ name: 'AuthSessionMissingError', status: 400 })).toBe('rejected');
  });

  it('keeps the session on anything the server did not decide', () => {
    // auth-js itself drops the stored session for all of these; we must not
    // treat that as a sign-out.
    expect(classifyRefreshFailure(authApi(500, undefined, 'dial tcp: connection refused'))).toBe('inconclusive');
    expect(classifyRefreshFailure(authApi(429, 'over_request_rate_limit'))).toBe('inconclusive');
    expect(classifyRefreshFailure(authApi(408))).toBe('inconclusive');
    expect(classifyRefreshFailure(retryable(0))).toBe('inconclusive');
    expect(classifyRefreshFailure(retryable(503))).toBe('inconclusive');
    expect(classifyRefreshFailure(unknown())).toBe('inconclusive');
    expect(classifyRefreshFailure({ name: 'AuthInvalidTokenResponseError', status: 500 })).toBe('inconclusive');
    expect(classifyRefreshFailure(new TypeError('Network request failed'))).toBe('inconclusive');
  });

  it('is conservative on shapes it has never seen', () => {
    const fuzz: unknown[] = [
      null,
      undefined,
      'boom',
      42,
      {},
      { status: '400' },
      { status: 400 }, // no auth-js name: a proxy or CDN page, not GoTrue
      { name: 'AuthApiError' }, // no status, no code
      { name: 'AuthApiError', status: 400, code: 'weak_password' },
      { name: 'SomethingNew', status: 401 },
      { code: 'invalid_grant', status: 'bad' },
    ];
    for (const e of fuzz) {
      const verdict = classifyRefreshFailure(e);
      // Only a code we know, or a GoTrue 4xx, may reject.
      const o = (e ?? {}) as { name?: string; status?: number; code?: string };
      const knownCode = o.code === 'invalid_grant';
      const gotrue4xx = o.name === 'AuthApiError' && typeof o.status === 'number' && o.status >= 400 && o.status < 500;
      expect(verdict, JSON.stringify(e)).toBe(knownCode || gotrue4xx ? 'rejected' : 'inconclusive');
    }
  });
});

describe('startupActionForRefreshFailure', () => {
  it('does nothing when nobody was signed in', () => {
    expect(startupActionForRefreshFailure(authApi(400, 'invalid_grant'), false)).toBe('none');
  });
  it('signs out only on a definitive rejection, otherwise keeps the stored session', () => {
    expect(startupActionForRefreshFailure(authApi(400, 'invalid_grant'), true)).toBe('sign-out');
    expect(startupActionForRefreshFailure(authApi(500), true)).toBe('keep-stale');
    expect(startupActionForRefreshFailure(authApi(429), true)).toBe('keep-stale');
    expect(startupActionForRefreshFailure(unknown(), true)).toBe('keep-stale');
    expect(startupActionForRefreshFailure(null, true)).toBe('keep-stale');
  });
});
