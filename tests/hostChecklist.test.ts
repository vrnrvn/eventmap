import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_STATUS,
  buildHostChecklist,
  checklistVisibility,
  parseHostStatus,
  type HostLocalSignals,
  type HostStatus,
} from '@/utils/hostChecklist';

const fresh: HostStatus = {
  hasLogo: false,
  hasDescription: false,
  publishedEvents: 0,
  eventsWithCapacity: 0,
  announcements: 0,
  recurringEvents: 0,
  notificationsEnabled: true,
};
const noLocal: HostLocalSignals = { sharedEvent: false, openedManage: false, pushGranted: true };
const ids = (c: ReturnType<typeof buildHostChecklist>) => c.items.map((i) => i.id);

describe('buildHostChecklist', () => {
  it('a brand-new venue sees every step, starting with the profile', () => {
    const c = buildHostChecklist({ hostType: 'venue', status: fresh, local: noLocal, premium: false });
    expect(ids(c)).toEqual(['profile', 'publish', 'share', 'manage', 'capacity', 'announce', 'series', 'notifications']);
    expect(c.next?.id).toBe('profile');
    // notifications: switch on + push granted
    expect(c.doneCount).toBe(1);
    expect(c.complete).toBe(false);
  });

  it('individuals do not get the series step and get personal wording', () => {
    const c = buildHostChecklist({ hostType: 'individual', status: fresh, local: noLocal, premium: true });
    expect(ids(c)).not.toContain('series');
    expect(c.items[0].title).toMatch(/photo/);
  });

  it('series points free hosts at the plans page', () => {
    const free = buildHostChecklist({ hostType: 'organiser', status: fresh, local: noLocal, premium: false });
    const pro = buildHostChecklist({ hostType: 'organiser', status: fresh, local: noLocal, premium: true });
    expect(free.items.find((i) => i.id === 'series')).toMatchObject({ route: '/premium/plans', premiumRequired: true });
    expect(pro.items.find((i) => i.id === 'series')).toMatchObject({ route: '/(tabs)/create', premiumRequired: false });
  });

  it('hides items whose state is unknown instead of nagging', () => {
    const c = buildHostChecklist({
      hostType: 'venue',
      status: { ...UNKNOWN_STATUS, publishedEvents: 3 },
      local: { ...noLocal, pushGranted: null },
      premium: false,
    });
    expect(ids(c)).toEqual(['publish', 'share', 'manage']);
    expect(c.items[0].done).toBe(true);
  });

  it('notifications: known-off wins over unknown', () => {
    const off = buildHostChecklist({
      hostType: 'venue',
      status: { ...fresh, notificationsEnabled: null },
      local: { ...noLocal, pushGranted: false },
      premium: false,
    });
    expect(off.items.find((i) => i.id === 'notifications')?.done).toBe(false);
  });

  it('is complete when every shown item is done', () => {
    const c = buildHostChecklist({
      hostType: 'individual',
      status: { hasLogo: true, hasDescription: true, publishedEvents: 2, eventsWithCapacity: 1, announcements: 1, recurringEvents: 0, notificationsEnabled: true },
      local: { sharedEvent: true, openedManage: true, pushGranted: true },
      premium: false,
    });
    expect(c.complete).toBe(true);
    expect(c.next).toBeNull();
  });

  it('nothing known at all yields an empty, not complete, list', () => {
    const c = buildHostChecklist({
      hostType: 'venue',
      status: UNKNOWN_STATUS,
      local: { sharedEvent: false, openedManage: false, pushGranted: null },
      premium: false,
    });
    // share/manage are local and always known
    expect(ids(c)).toEqual(['share', 'manage']);
  });
});

describe('checklistVisibility', () => {
  const c = buildHostChecklist({ hostType: 'venue', status: fresh, local: noLocal, premium: false });
  it('expanded for new hosts, collapsed for hosts active before the checklist', () => {
    expect(checklistVisibility({ checklist: c, dismissed: false, preexistingHost: false })).toBe('expanded');
    expect(checklistVisibility({ checklist: c, dismissed: false, preexistingHost: true })).toBe('collapsed');
  });
  it('hidden when dismissed, complete or empty', () => {
    expect(checklistVisibility({ checklist: c, dismissed: true, preexistingHost: false })).toBe('hidden');
    expect(checklistVisibility({ checklist: { ...c, complete: true }, dismissed: false, preexistingHost: false })).toBe('hidden');
    expect(checklistVisibility({ checklist: { ...c, total: 0, items: [] }, dismissed: false, preexistingHost: false })).toBe('hidden');
  });
});

describe('parseHostStatus', () => {
  it('reads the RPC payload and treats bad values as unknown', () => {
    expect(
      parseHostStatus({ has_logo: true, has_description: false, published_events: 2, events_with_capacity: -1, announcements: 'x', recurring_events: 0, notifications_enabled: true })
    ).toEqual({ hasLogo: true, hasDescription: false, publishedEvents: 2, eventsWithCapacity: null, announcements: null, recurringEvents: 0, notificationsEnabled: true });
    expect(parseHostStatus(null)).toEqual(UNKNOWN_STATUS);
  });
});

describe('verification step', () => {
  const base = { hostType: 'venue' as const, status: fresh, local: noLocal, premium: false };
  it('hidden when unknown or unavailable', () => {
    expect(ids(buildHostChecklist(base))).not.toContain('verify');
    expect(ids(buildHostChecklist({ ...base, verification: null }))).not.toContain('verify');
  });
  it('shown to do, then ticked once requested or verified', () => {
    const item = (v: 'verified' | 'requested' | 'none') =>
      buildHostChecklist({ ...base, verification: v }).items.find((i) => i.id === 'verify');
    expect(item('none')?.done).toBe(false);
    expect(item('requested')?.done).toBe(true);
    expect(item('verified')?.done).toBe(true);
  });
  it('not offered to individuals', () => {
    expect(ids(buildHostChecklist({ ...base, hostType: 'individual', verification: 'none' }))).not.toContain('verify');
  });
});

