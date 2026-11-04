import { describe, expect, it } from 'vitest';
import {
  abbreviateName,
  formatSecondaryCounts,
  getHostActions,
  getHostEventPhase,
  summarizeCapacity,
} from '@/utils/hostEvent';

const now = new Date('2026-11-03T12:00:00Z');
const hour = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();

describe('getHostEventPhase', () => {
  it('reports cancelled before anything else', () => {
    expect(
      getHostEventPhase(
        { status: 'cancelled', start_datetime: iso(hour), end_datetime: iso(2 * hour) },
        now
      )
    ).toBe('cancelled');
  });

  it('distinguishes upcoming, live and ended one-off events', () => {
    expect(getHostEventPhase({ start_datetime: iso(hour), end_datetime: iso(2 * hour) }, now)).toBe(
      'upcoming'
    );
    expect(getHostEventPhase({ start_datetime: iso(-hour), end_datetime: iso(hour) }, now)).toBe(
      'live'
    );
    expect(
      getHostEventPhase({ start_datetime: iso(-3 * hour), end_datetime: iso(-hour) }, now)
    ).toBe('ended');
  });

  it('keeps an open-ended recurring series upcoming even when the first end passed', () => {
    expect(
      getHostEventPhase(
        {
          start_datetime: iso(-48 * hour),
          end_datetime: iso(-46 * hour),
          is_recurring: true,
          recurrence_pattern: { frequency: 'weekly', interval: 1 },
        },
        now
      )
    ).toBe('upcoming');
  });

  it('ends a recurring series once its end date passes', () => {
    expect(
      getHostEventPhase(
        {
          start_datetime: iso(-48 * hour),
          end_datetime: iso(-46 * hour),
          is_recurring: true,
          recurrence_pattern: { frequency: 'weekly', interval: 1, endDate: '2026-10-01' },
        },
        now
      )
    ).toBe('ended');
  });
});

describe('summarizeCapacity', () => {
  it('treats null, undefined and zero as unlimited', () => {
    for (const max of [null, undefined, 0]) {
      expect(summarizeCapacity(7, max)).toEqual({
        label: '7 going',
        ratio: null,
        spotsLeft: null,
        isFull: false,
      });
    }
  });

  it('computes spots left and fill ratio', () => {
    expect(summarizeCapacity(10, 40)).toEqual({
      label: '10 / 40 going',
      ratio: 0.25,
      spotsLeft: 30,
      isFull: false,
    });
  });

  it('never reports negative spots when the cap was lowered below attendance', () => {
    const s = summarizeCapacity(12, 10);
    expect(s.spotsLeft).toBe(0);
    expect(s.ratio).toBe(1);
    expect(s.isFull).toBe(true);
  });
});

describe('getHostActions', () => {
  it('leaves only insights and chat for ended events', () => {
    expect(getHostActions('ended')).toMatchObject({
      canEdit: false,
      canCancel: false,
      canManageAttendees: false,
      canModerateChat: true,
      canViewInsights: true,
    });
  });

  it('makes cancelled events read-only, including chat', () => {
    expect(getHostActions('cancelled')).toMatchObject({
      canEdit: false,
      canCancel: false,
      canModerateChat: false,
      canViewInsights: true,
    });
  });

  it('allows the normal host actions for upcoming events', () => {
    expect(getHostActions('upcoming')).toMatchObject({
      canEdit: true,
      canCancel: true,
      canNotifyFollowers: true,
      canManageAttendees: true,
      canModerateChat: true,
      canViewInsights: true,
      canPublish: false,
      canPostpone: true,
      canReschedule: true,
      canDuplicate: true,
    });
  });

  it('treats drafts and postponed events as their own phases', () => {
    const future = { start_datetime: iso(hour), end_datetime: iso(2 * hour) };
    expect(getHostEventPhase({ ...future, publish_state: 'draft' }, now)).toBe('draft');
    expect(getHostEventPhase({ ...future, status: 'postponed' }, now)).toBe('postponed');
    // Cancelled wins over everything; a past draft is still a draft.
    expect(getHostEventPhase({ ...future, status: 'cancelled', publish_state: 'draft' }, now)).toBe('cancelled');
    expect(
      getHostEventPhase({ start_datetime: iso(-3 * hour), end_datetime: iso(-hour), publish_state: 'draft' }, now)
    ).toBe('draft');
    expect(getHostActions('draft')).toMatchObject({ canPublish: true, canCancel: false, canModerateChat: false, canDuplicate: false });
    expect(getHostActions('postponed')).toMatchObject({ canReschedule: true, canPostpone: false, canCancel: true });
  });
});

describe('formatSecondaryCounts', () => {
  it('omits the waitlist when unknown or empty and pluralises saves', () => {
    expect(formatSecondaryCounts({ going: 4, interested: 3, waitlist: null, saves: 1 })).toBe(
      '3 interested · 1 save'
    );
    expect(formatSecondaryCounts({ going: 4, interested: 0, waitlist: 0, saves: 9 })).toBe(
      '0 interested · 9 saves'
    );
  });

  it('skips interested when the host RPC is unavailable', () => {
    expect(formatSecondaryCounts({ going: 4, interested: null, waitlist: 2, saves: 0 })).toBe(
      '2 waiting · 0 saves'
    );
  });

  it('includes a non-empty waitlist', () => {
    expect(formatSecondaryCounts({ going: 40, interested: 3, waitlist: 2, saves: 9 })).toBe(
      '3 interested · 2 waiting · 9 saves'
    );
  });
});

describe('abbreviateName', () => {
  it('keeps the first name and shortens the last to an initial', () => {
    expect(abbreviateName('Samantha Kaur')).toBe('Samantha K.');
    expect(abbreviateName('  Sam   van Dyke ')).toBe('Sam D.');
  });

  it('leaves single names alone and falls back for empty input', () => {
    expect(abbreviateName('sam')).toBe('sam');
    expect(abbreviateName('')).toBe('Attendee');
    expect(abbreviateName(null)).toBe('Attendee');
    expect(abbreviateName(undefined)).toBe('Attendee');
  });
});
