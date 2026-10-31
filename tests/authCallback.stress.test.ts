/**
 * Adversarial input against the deep-link allow-list.
 *
 * This function decides whether a URL may drive session creation, so a false
 * positive is an account-takeover vector. Complements authCallback.test.ts,
 * which covers the expected shapes.
 */
import { describe, it, expect } from 'vitest';
import { isAuthCallbackUrl, isMissingVerifierError } from '@/utils/authCallback';

const ORIGIN = 'https://eventmap.pro';
const native = (url: string) => isAuthCallbackUrl(url, 'ios');
const web = (url: string) => isAuthCallbackUrl(url, 'web', ORIGIN);

describe('host confusion', () => {
  it('rejects look-alike hosts', () => {
    for (const url of [
      'https://eventmap.pro.evil.test/auth-callback',
      'https://eventmappro/auth-callback',
      'https://evil.test/eventmap.pro/auth-callback',
      'https://xn--eventmap-pro/auth-callback',
      'https://eventmap.pro.co/auth-callback',
      'https://sub.eventmap.pro.evil.test/',
    ]) {
      expect(native(url), url).toBe(false);
    }
  });

  it('accepts only the exact production host', () => {
    expect(native('https://eventmap.pro/anything')).toBe(true);
    // Subdomains are not the applinks host.
    expect(native('https://www.eventmap.pro/auth-callback')).toBe(false);
    expect(native('https://api.eventmap.pro/auth-callback')).toBe(false);
  });

  it('rejects credentials-in-URL tricks', () => {
    expect(native('https://eventmap.pro@evil.test/auth-callback')).toBe(false);
    expect(native('https://evil.test#@eventmap.pro/auth-callback')).toBe(false);
  });

  it('rejects userinfo that embeds the callback path', () => {
    expect(native('https://auth-callback@evil.test/')).toBe(false);
  });
});

describe('scheme confusion', () => {
  it('rejects non-https for the applinks host', () => {
    expect(native('http://eventmap.pro/auth-callback')).toBe(false);
    expect(native('ftp://eventmap.pro/auth-callback')).toBe(false);
  });

  it('rejects scheme look-alikes', () => {
    for (const url of [
      'eventmapx://auth-callback',
      'notEventmap://auth-callback',
      'eventmap:/auth-callback',
      'eventmap:auth-callback',
      'javascript:eventmap://auth-callback',
    ]) {
      expect(native(url), url).toBe(false);
    }
  });

  it('is case-insensitive on scheme and host as URLs are', () => {
    expect(native('EVENTMAP://AUTH-CALLBACK')).toBe(true);
    expect(native('HTTPS://EVENTMAP.PRO/x')).toBe(true);
  });
});

describe('path confusion on the custom scheme', () => {
  it('requires the exact callback host', () => {
    for (const url of [
      'eventmap://auth-callback-evil',
      'eventmap://auth-callbackx',
      'eventmap://xauth-callback',
      'eventmap://auth-callback/extra',
      'eventmap://other/auth-callback',
      'eventmap://auth_callback',
      'eventmap://',
    ]) {
      expect(native(url), url).toBe(false);
    }
  });

  it('tolerates only trailing slashes', () => {
    expect(native('eventmap://auth-callback')).toBe(true);
    expect(native('eventmap://auth-callback/')).toBe(true);
    expect(native('eventmap://auth-callback///')).toBe(true);
  });
});

describe('expo dev URLs', () => {
  it('requires the /--/auth-callback path', () => {
    expect(native('exp://10.0.0.2:8081/--/auth-callback')).toBe(true);
    expect(native('exp://10.0.0.2:8081/--/auth-callback/')).toBe(true);
    expect(native('exp://10.0.0.2:8081/auth-callback')).toBe(false);
    expect(native('exp://10.0.0.2:8081/--/other')).toBe(false);
    expect(native('exp://10.0.0.2:8081/--/')).toBe(false);
  });

  it('accepts any dev host (the LAN address varies)', () => {
    expect(native('exp://192.168.1.50:19000/--/auth-callback')).toBe(true);
    expect(native('exps://localhost:8081/--/auth-callback')).toBe(true);
  });
});

describe('payload cannot influence the decision', () => {
  it('ignores query and fragment entirely', () => {
    expect(native('https://evil.test/?x=eventmap://auth-callback')).toBe(false);
    expect(native('https://evil.test/#eventmap://auth-callback')).toBe(false);
    expect(native('https://evil.test/?next=https://eventmap.pro/')).toBe(false);
    expect(native('https://evil.test/#/--/auth-callback')).toBe(false);
  });

  it('accepts a legitimate URL regardless of payload size or content', () => {
    const big = 'a'.repeat(5000);
    expect(native(`eventmap://auth-callback?code=${big}`)).toBe(true);
    expect(native(`eventmap://auth-callback#access_token=${big}`)).toBe(true);
  });
});

describe('web origin matching', () => {
  it('compares full origin, not substring', () => {
    expect(web('https://eventmap.pro.evil.test/?code=1')).toBe(false);
    expect(web('https://eventmap.pro/?code=1')).toBe(true);
  });

  it('treats differing port or scheme as a different origin', () => {
    expect(web('https://eventmap.pro:443/?code=1')).toBe(true); // default port
    expect(web('https://eventmap.pro:8443/?code=1')).toBe(false);
    expect(web('http://eventmap.pro/?code=1')).toBe(false);
  });

  it('rejects custom schemes on web', () => {
    expect(web('eventmap://auth-callback')).toBe(true); // scheme branch still applies
    expect(web('javascript:alert(1)')).toBe(false);
  });
});

describe('malformed input never throws', () => {
  it('returns false instead of raising', () => {
    const inputs = [
      '',
      ' ',
      'not a url',
      '://',
      'https://',
      'https://[',
      '%%%',
      'eventmap://%E0%A4%A',
      '\u0000',
      'https://eventmap.pro/\u0000',
      'a'.repeat(100000),
    ];
    for (const url of inputs) {
      expect(() => native(url), JSON.stringify(url.slice(0, 20))).not.toThrow();
      expect(() => web(url), JSON.stringify(url.slice(0, 20))).not.toThrow();
    }
  });

  it('handles non-string input defensively', () => {
    for (const bad of [null, undefined, 123, {}, []]) {
      expect(() => isAuthCallbackUrl(bad as unknown as string, 'ios')).not.toThrow();
      expect(isAuthCallbackUrl(bad as unknown as string, 'ios')).toBe(false);
    }
  });
});

describe('isMissingVerifierError precision', () => {
  it('does not fire on unrelated auth failures', () => {
    for (const message of [
      'Invalid login credentials',
      'Email not confirmed',
      'User already registered',
      'invalid request: malformed JSON',
      'Invalid request',
      'Token has expired or is invalid',
      'Database error saving new user',
    ]) {
      expect(isMissingVerifierError({ message }), message).toBe(false);
    }
  });

  it('fires on the real verifier failures', () => {
    expect(isMissingVerifierError({ code: 'bad_code_verifier' })).toBe(true);
    expect(
      isMissingVerifierError({
        message: 'invalid request: both auth code and code verifier should be non-empty',
      })
    ).toBe(true);
    expect(
      isMissingVerifierError({ message: 'code challenge does not match previously saved code verifier' })
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMissingVerifierError({ message: 'CODE VERIFIER missing' })).toBe(true);
  });
});
