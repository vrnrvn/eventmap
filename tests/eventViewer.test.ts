/**
 * The event page's viewer seam (utils/eventViewer.ts, rehearsal Phase 1).
 * The derivation moved out of screens/EventDetail.tsx unchanged; these pin it
 * so Phase 2 can override the object without re-deriving anything.
 */
import { describe, expect, it } from 'vitest';
import { deriveEventViewer, type EventViewer } from '@/utils/eventViewer';
import type { EventDetails } from '@/types/database';

const now = new Date('2026-11-17T19:00:00Z');
const HOUR = 60 * 60 * 1000;
const iso = (h: number) => new Date(now.getTime() + h * HOUR).toISOString();

const baseEvent = {
  id: 'e1',
  business_id: 'b1',
  title: 'Jazz night',
  start_datetime: iso(24),
  end_datetime: iso(26),
  status: 'active',
  publish_state: 'published',
  visibility: 'public',
} as EventDetails['event'];

function derive(
  over: Partial<EventDetails['event']> = {},
  detailsOver: Partial<Pick<EventDetails, 'rsvp_count' | 'user_rsvp' | 'waitlist'>> = {},
  who: { userId?: string | null; userBusinessId?: string | null } = {}
): EventViewer {
  return deriveEventViewer({
    details: {
      event: { ...baseEvent, ...over },
      rsvp_count: 3,
      user_rsvp: null,
      ...detailsOver,
    },
    userId: who.userId === undefined ? 'u1' : who.userId,
    userBusinessId: who.userBusinessId === undefined ? null : who.userBusinessId,
    now,
  });
}

describe('role', () => {
  it('owner / attendee / visitor', () => {
    expect(derive({}, {}, { userBusinessId: 'b1' }).role).toBe('owner');
    expect(derive({}, {}, { userBusinessId: 'b1' }).isOwner).toBe(true);
    expect(derive({}, {}, { userBusinessId: 'b2' }).role).toBe('attendee');
    expect(derive().role).toBe('attendee');
    expect(derive({}, {}, { userId: null }).role).toBe('visitor');
    expect(derive({}, {}, { userId: null }).isOwner).toBe(false);
  });
});

describe('rsvp and lifecycle flags', () => {
  it('maps the viewer RSVP', () => {
    const v = derive({}, { user_rsvp: 'going' });
    expect([v.hasJoined, v.hasRequested, v.rsvp]).toEqual([true, false, 'going']);
    expect(derive({}, { user_rsvp: 'requested' }).hasRequested).toBe(true);
    expect(derive({ rsvp_mode: 'approval' }).approvalMode).toBe(true);
  });

  it('closed = ended, cancelled, postponed, draft or RSVPs switched off', () => {
    expect(derive().closed).toBe(false);
    expect(derive({ start_datetime: iso(-3), end_datetime: iso(-1) }).ended).toBe(true);
    expect(derive({ start_datetime: iso(-3), end_datetime: iso(-1) }).closed).toBe(true);
    expect(derive({ status: 'cancelled' }).closed).toBe(true);
    expect(derive({ status: 'postponed' }).closed).toBe(true);
    expect(derive({ publish_state: 'draft' }).closed).toBe(true);
    expect(derive({ rsvp_closed: true }).closed).toBe(true);
  });

  it('closing RSVPs does not close the page for someone already in', () => {
    const v = derive({ rsvp_closed: true }, { user_rsvp: 'going' });
    expect(v.rsvpsClosedByHost).toBe(false);
    expect(v.closed).toBe(false);
  });

  it('live while running; a cancelled event is never live', () => {
    expect(derive({ start_datetime: iso(-1), end_datetime: iso(1) }).live).toBe(true);
    expect(derive({ start_datetime: iso(-1), end_datetime: iso(1), status: 'cancelled' }).live).toBe(false);
  });
});

describe('capacity and waitlist', () => {
  it('full counts seats, but never against someone already in', () => {
    expect(derive({ max_attendees: 3 }).full).toBe(true);
    expect(derive({ max_attendees: 4 }).full).toBe(false);
    expect(derive({ max_attendees: 3 }, { user_rsvp: 'going' }).full).toBe(false);
  });

  it('no waitlist key (pre-20261102160000) means no waitlist CTA', () => {
    expect(derive({ max_attendees: 3 }).canWaitlist).toBe(false);
  });

  it('a full open event offers the waitlist; a pending request takes precedence', () => {
    const wl = { count: 1, position: null, notified_at: null };
    expect(derive({ max_attendees: 3 }, { waitlist: wl }).canWaitlist).toBe(true);
    expect(derive({ max_attendees: 3 }, { waitlist: wl, user_rsvp: 'requested' }).canWaitlist).toBe(false);
    expect(derive({ max_attendees: 3 }, { waitlist: wl }, { userId: null }).canWaitlist).toBe(false);
  });

  it('no waitlist CTA when the host switched it off or the event takes requests (EJ-25)', () => {
    const wl = { count: 1, position: null, notified_at: null };
    expect(derive({ max_attendees: 3, waitlist_mode: 'off' }, { waitlist: wl }).canWaitlist).toBe(false);
    expect(derive({ max_attendees: 3, rsvp_mode: 'approval' }, { waitlist: wl }).canWaitlist).toBe(false);
    expect(derive({ max_attendees: 3, waitlist_mode: 'notify' }, { waitlist: wl }).canWaitlist).toBe(true);
    // Someone already in line can still leave it after the host turns it off.
    const mine = { count: 2, position: 1, notified_at: null };
    expect(derive({ max_attendees: 3, waitlist_mode: 'off' }, { waitlist: mine }).canWaitlist).toBe(true);
  });

  it('leaving the waitlist survives closed RSVPs and a postponement', () => {
    const mine = { count: 2, position: 1, notified_at: null };
    expect(derive({ max_attendees: 3, rsvp_closed: true }, { waitlist: mine }).onWaitlist).toBe(true);
    expect(derive({ max_attendees: 3, rsvp_closed: true }, { waitlist: mine }).canWaitlist).toBe(true);
    expect(derive({ max_attendees: 3, status: 'postponed' }, { waitlist: mine }).canWaitlist).toBe(true);
    expect(derive({ max_attendees: 3, status: 'cancelled' }, { waitlist: mine }).canWaitlist).toBe(false);
  });
});

describe('header date', () => {
  const weekly = {
    start_datetime: '2026-11-03T18:00:00.000Z', // Tuesdays 18:00–20:00 UTC
    end_datetime: '2026-11-03T20:00:00.000Z',
    is_recurring: true,
    recurrence_pattern: { frequency: 'weekly' as const, interval: 1 },
    timezone: 'UTC',
  };

  it('a one-off always shows its scheduled start', () => {
    expect(derive().displayStartIso).toBe(baseEvent.start_datetime);
    expect(derive().liveOccurrence).toBeNull();
  });

  it('a running series date is shown itself, not next week (A6)', () => {
    const v = derive(weekly); // 2026-11-17 19:00 is inside the 18:00–20:00 session
    expect(v.live).toBe(true);
    expect(v.liveOccurrence?.dateKey).toBe('2026-11-17');
    expect(v.displayStartIso).toBe('2026-11-17T18:00:00.000Z');
  });

  it('a started series otherwise shows its next date', () => {
    const v = deriveEventViewer({
      details: { event: { ...baseEvent, ...weekly }, rsvp_count: 3, user_rsvp: null },
      userId: 'u1',
      userBusinessId: null,
      now: new Date('2026-11-17T21:00:00Z'), // today's session is over
    });
    expect(v.live).toBe(false);
    expect(v.displayStartIso).toBe('2026-11-24T18:00:00.000Z');
  });

  it('a skipped next date is honoured', () => {
    const v = deriveEventViewer({
      details: { event: { ...baseEvent, ...weekly }, rsvp_count: 3, user_rsvp: null },
      userId: 'u1',
      userBusinessId: null,
      exceptions: [
        { event_id: 'e1', occurrence_date: '2026-11-24', kind: 'cancelled', new_start: null, new_end: null, note: null },
      ],
      now: new Date('2026-11-17T21:00:00Z'),
    });
    expect(v.displayStartIso).toBe('2026-12-01T18:00:00.000Z');
  });
});
