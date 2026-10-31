import { describe, it, expect } from 'vitest';
import { isAuthCallbackUrl, isMissingVerifierError } from '@/utils/authCallback';

const ORIGIN = 'https://eventmap.pro';

describe('isAuthCallbackUrl — native', () => {
  const accepts = (url: string) => isAuthCallbackUrl(url, 'ios');

  it('accepts the registered scheme callback', () => {
    expect(accepts('eventmap://auth-callback')).toBe(true);
    expect(accepts('eventmap://auth-callback/')).toBe(true);
    expect(accepts('EventMap://Auth-Callback')).toBe(true);
    expect(accepts('eventmap://auth-callback?code=abc')).toBe(true);
    expect(accepts('eventmap://auth-callback#access_token=abc')).toBe(true);
  });

  it('accepts Expo dev callbacks', () => {
    expect(accepts('exp://192.168.1.5:8081/--/auth-callback')).toBe(true);
    expect(accepts('exps://192.168.1.5:8081/--/auth-callback?code=abc')).toBe(true);
  });

  it('accepts the production universal-link host', () => {
    expect(accepts('https://eventmap.pro/auth-callback?code=abc')).toBe(true);
    expect(accepts('https://eventmap.pro/anything')).toBe(true);
  });

  it('rejects other hosts on the same scheme', () => {
    expect(accepts('https://evil.test/auth-callback?code=abc')).toBe(false);
    // Hostname must match exactly — not merely end with our domain.
    expect(accepts('https://eventmap.pro.evil.test/auth-callback')).toBe(false);
    expect(accepts('https://noteventmap.pro/auth-callback')).toBe(false);
  });

  it('rejects non-callback paths on our own scheme', () => {
    expect(accepts('eventmap://event/123')).toBe(false);
    expect(accepts('eventmap://auth-callback-evil')).toBe(false);
    expect(accepts('eventmap://other/auth-callback')).toBe(false);
    expect(accepts('exp://192.168.1.5:8081/--/event/123')).toBe(false);
    expect(accepts('exp://192.168.1.5:8081')).toBe(false);
  });

  it('rejects foreign schemes and junk', () => {
    expect(accepts('javascript:alert(1)')).toBe(false);
    expect(accepts('file:///etc/passwd')).toBe(false);
    expect(accepts('http://eventmap.pro/auth-callback')).toBe(false); // plaintext
    expect(accepts('')).toBe(false);
    expect(accepts('not a url')).toBe(false);
  });

  it('cannot be influenced by the token payload itself', () => {
    // The query/fragment is stripped before matching, so a payload that looks
    // like an allowed URL must not launder a disallowed one.
    expect(accepts('https://evil.test/x?next=eventmap://auth-callback')).toBe(false);
    expect(accepts('https://evil.test/x#eventmap://auth-callback')).toBe(false);
  });
});

describe('isAuthCallbackUrl — web', () => {
  it('accepts same-origin URLs only', () => {
    expect(isAuthCallbackUrl(`${ORIGIN}/?code=abc`, 'web', ORIGIN)).toBe(true);
    expect(isAuthCallbackUrl(`${ORIGIN}/reset#access_token=abc`, 'web', ORIGIN)).toBe(true);
    expect(isAuthCallbackUrl('https://evil.test/?code=abc', 'web', ORIGIN)).toBe(false);
    // Same host, different port/scheme are different origins.
    expect(isAuthCallbackUrl('https://eventmap.pro:8443/?code=abc', 'web', ORIGIN)).toBe(false);
    expect(isAuthCallbackUrl('http://eventmap.pro/?code=abc', 'web', ORIGIN)).toBe(false);
  });

  it('accepts a localhost dev origin', () => {
    const dev = 'http://localhost:8081';
    expect(isAuthCallbackUrl(`${dev}/?code=abc`, 'web', dev)).toBe(true);
    expect(isAuthCallbackUrl('http://localhost:9999/?code=abc', 'web', dev)).toBe(false);
  });

  it('rejects everything when the origin is unknown', () => {
    expect(isAuthCallbackUrl(`${ORIGIN}/?code=abc`, 'web', undefined)).toBe(false);
  });
});

describe('isMissingVerifierError', () => {
  it('detects the verifier-mismatch cases', () => {
    expect(isMissingVerifierError({ code: 'bad_code_verifier' })).toBe(true);
    expect(
      isMissingVerifierError({
        message: 'invalid request: both auth code and code verifier should be non-empty',
      })
    ).toBe(true);
    expect(
      isMissingVerifierError({
        message: 'code challenge does not match previously saved code verifier',
      })
    ).toBe(true);
    expect(isMissingVerifierError({ message: 'Invalid code_verifier' })).toBe(true);
  });

  it('does not claim wrong-device for unrelated 400s', () => {
    // Regression: matching the bare "invalid request" prefix showed the
    // "open this on the device where you requested it" advice for failures
    // that have nothing to do with the device.
    expect(isMissingVerifierError({ message: 'invalid request: malformed JSON' })).toBe(false);
    expect(isMissingVerifierError({ message: 'Invalid request' })).toBe(false);
    expect(isMissingVerifierError({ message: 'Email link is invalid or has expired' })).toBe(false);
    expect(isMissingVerifierError({ code: 'otp_expired' })).toBe(false);
  });

  it('handles absent or malformed errors', () => {
    expect(isMissingVerifierError(null)).toBe(false);
    expect(isMissingVerifierError(undefined)).toBe(false);
    expect(isMissingVerifierError({})).toBe(false);
    expect(isMissingVerifierError({ message: 123 })).toBe(false);
  });
});
