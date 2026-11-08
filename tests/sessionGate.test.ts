import { describe, it, expect } from 'vitest';
import { SessionNotReadyError, shouldBlockAnonRequest } from '../utils/sessionGate';
import { classifyError, isConnectionError } from '../utils/networkErrors';

const ANON = 'anon.key.value';
const REST = 'http://127.0.0.1:9/rest/v1/notifications?select=*';

describe('shouldBlockAnonRequest', () => {
  it('blocks a REST request carrying the anon key while a user is signed in', () => {
    expect(shouldBlockAnonRequest(REST, { Authorization: `Bearer ${ANON}` }, ANON, true)).toBe(true);
    expect(shouldBlockAnonRequest(REST, { authorization: `bearer ${ANON}` }, ANON, true)).toBe(true);
    expect(shouldBlockAnonRequest(REST, new Headers({ Authorization: `Bearer ${ANON}` }), ANON, true)).toBe(true);
    expect(shouldBlockAnonRequest(REST, [['Authorization', `Bearer ${ANON}`]], ANON, true)).toBe(true);
    expect(shouldBlockAnonRequest(REST, {}, ANON, true)).toBe(true); // no token = anon
  });

  it('lets a REST request with a user token through', () => {
    expect(shouldBlockAnonRequest(REST, { Authorization: 'Bearer eyJ.user.jwt' }, ANON, true)).toBe(false);
  });

  it('never blocks when nobody is signed in', () => {
    expect(shouldBlockAnonRequest(REST, { Authorization: `Bearer ${ANON}` }, ANON, false)).toBe(false);
  });

  it('never blocks auth, storage or realtime requests', () => {
    const h = { Authorization: `Bearer ${ANON}` };
    expect(shouldBlockAnonRequest('http://x/auth/v1/token?grant_type=refresh_token', h, ANON, true)).toBe(false);
    expect(shouldBlockAnonRequest('http://x/storage/v1/object/public/a.jpg', h, ANON, true)).toBe(false);
    expect(shouldBlockAnonRequest('http://x/realtime/v1/websocket', h, ANON, true)).toBe(false);
  });
});

describe('SessionNotReadyError', () => {
  it('is a connection-class failure (cached data stays, retried later), not a refusal', () => {
    const err = new SessionNotReadyError();
    expect(classifyError(err)).toBe('network');
    expect(isConnectionError(err)).toBe(true);
  });
});
