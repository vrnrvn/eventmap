import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * notify.backgroundError is for refreshes the user didn't ask for. It must
 * stay quiet when the failure is the connection itself (the banner explains
 * that) or a request the session gate refused while the session was being
 * re-verified — both used to produce a misleading "Couldn't refresh…" toast.
 */
const state = vi.hoisted(() => ({ impaired: false }));
vi.mock('@/utils/connectivity', () => ({
  isConnectionImpaired: () => state.impaired,
  getConnectivity: () => (state.impaired ? 'offline' : 'online'),
}));

const { notify, registerNotifyHost } = await import('@/utils/notify');
const { SessionNotReadyError } = await import('@/utils/sessionGate');

let shown: string[] = [];
let unregister = () => {};
beforeEach(() => {
  shown = [];
  state.impaired = false;
  unregister();
  unregister = registerNotifyHost((t) => shown.push(`${t.kind}:${t.message}`), () => {});
});

describe('notify.backgroundError', () => {
  it('shows a real server failure', () => {
    notify.backgroundError("Couldn't refresh.", { code: 'P0001', message: 'boom' });
    expect(shown).toEqual(["error:Couldn't refresh."]);
  });

  it('stays quiet for a session-gate refusal (classified as a connection error)', () => {
    notify.backgroundError("Couldn't refresh.", new SessionNotReadyError());
    expect(shown).toEqual([]);
  });

  it('stays quiet for a dropped connection, and while the banner is up', () => {
    notify.backgroundError("Couldn't refresh.", new TypeError('Failed to fetch'));
    state.impaired = true;
    notify.backgroundError("Couldn't refresh.");
    expect(shown).toEqual([]);
  });

  it('without an error object behaves as before', () => {
    notify.backgroundError("Couldn't refresh.");
    expect(shown).toEqual(["error:Couldn't refresh."]);
  });
});
