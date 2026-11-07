import { UID } from './fakebackend.mjs';
export function session(expOffsetS = 3600) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expOffsetS;
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, role: 'authenticated', exp, aud: 'authenticated' })}.sig`;
  const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'tester@example.test', app_metadata: { provider: 'email' }, user_metadata: { name: 'Test User' }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
  return { access_token: jwt, refresh_token: 'r1', expires_in: 3600, expires_at: exp, token_type: 'bearer', user };
}
/** localStorage seeding script run before the app on every navigation (only fills empty keys). */
export function sessionSeed(extra = {}, expOffsetS = 3600) {
  const entries = { 'sb-127-auth-token': JSON.stringify(session(expOffsetS)), ...extra };
  return `for (const [k, v] of Object.entries(${JSON.stringify(entries)})) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);`;
}
