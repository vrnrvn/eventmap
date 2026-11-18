/**
 * "Preview as attendee" core (utils/rehearsal.ts, rehearsal Phase 2): the
 * simulated attendee's page data and the transitions, checked against the
 * same viewer derivation the screen uses.
 */
import { describe, expect, it } from 'vitest';
import { deriveEventViewer } from '@/utils/eventViewer';
import {
  REHEARSAL_START,
  rehearsalDetails,
  rehearseDate,
  rehearseJoinWaitlist,
  rehearseLeave,
  rehearseLeaveWaitlist,
  rehearseRsvp,
  scenarioNow,
  scenarioOptions,
  type RehearsalSim,
} from '@/utils/rehearsal';
import type { EventDetails } from '@/types/database';

const now = new Date('2026-11-17T12:00:00Z');
const iso = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();

function real(over: Partial<EventDetails['event']> = {}, detailsOver: Partial<EventDetails> = {}): EventDetails {
  return {
    event: {
      id: 'e1', business_id: 'b1', title: 'Jazz night',
      start_datetime: iso(24), end_datetime: iso(26),
      status: 'active', publish_state: 'published', visibility: 'public',
      ...over,
    } as EventDetails['event'],
    business: { id: 'b1' } as EventDetails['business'],
    category: {} as EventDetails['category'],
    links: [], photos: [],
    rsvp_count: 3, save_count: 5,
    user_rsvp: null, user_saved: false, user_following_business: false,
    ...detailsOver,
  };
}

/** The view the simulated attendee gets: the host's own ids, but never as owner. */
const viewOf = (r: EventDetails, sim: RehearsalSim) =>
  deriveEventViewer({ details: rehearsalDetails(r, sim), userId: 'host', userBusinessId: null, now });

describe('rehearsalDetails', () => {
  it('starts as a first-time visitor whatever the host has done', () => {
    const d = rehearsalDetails(real({}, { user_rsvp: 'going', user_saved: true }), REHEARSAL_START);
    expect([d.user_rsvp, d.user_saved, d.user_following_business]).toEqual([null, false, false]);
    expect(d.rsvp_count).toBe(3);
  });

  it('counts move with the simulated attendee', () => {
    const d = rehearsalDetails(real(), { ...REHEARSAL_START, rsvp: 'going', saved: true });
    expect(d.rsvp_count).toBe(4);
    expect(d.save_count).toBe(6);
  });

  it('a draft is shown as published — how guests will first meet it', () => {
    expect(rehearsalDetails(real({ publish_state: 'draft' }), REHEARSAL_START).event.publish_state).toBe('published');
    expect(viewOf(real({ publish_state: 'draft' }), REHEARSAL_START).closed).toBe(false);
  });

  it('the host is never the owner inside the preview', () => {
    expect(viewOf(real(), REHEARSAL_START).isOwner).toBe(false);
    expect(viewOf(real(), REHEARSAL_START).role).toBe('attendee');
  });

  it('a simulated waitlist place comes after the real line', () => {
    const r = real({}, { waitlist: { count: 2, position: null, notified_at: null } });
    const d = rehearsalDetails(r, { ...REHEARSAL_START, onWaitlist: true });
    expect(d.waitlist).toEqual({ count: 3, position: 3, notified_at: null });
  });
});

describe('transitions', () => {
  it('join → going, with the calendar prompt the real flow shows', () => {
    const r = real();
    const out = rehearseRsvp(REHEARSAL_START, 'going', viewOf(r, REHEARSAL_START));
    expect(out.sim.rsvp).toBe('going');
    expect(out.offerCalendar).toBe(true);
    expect(viewOf(r, out.sim).hasJoined).toBe(true);
  });

  it('approval mode turns a join into a request', () => {
    const r = real({ rsvp_mode: 'approval' });
    const out = rehearseRsvp(REHEARSAL_START, 'going', viewOf(r, REHEARSAL_START));
    expect(out.sim.rsvp).toBe('requested');
    expect(out.message?.text).toMatch(/Request sent/);
  });

  it('a full event refuses the join with the real copy, and offers the waitlist', () => {
    const r = real({ max_attendees: 3 }, { waitlist: { count: 1, position: null, notified_at: null } });
    const view = viewOf(r, REHEARSAL_START);
    expect(view.full).toBe(true);
    const refused = rehearseRsvp(REHEARSAL_START, 'going', view);
    expect(refused.sim.rsvp).toBeNull();
    expect(refused.message?.tone).toBe('error');
    const wl = rehearseJoinWaitlist(REHEARSAL_START, view);
    expect(wl.sim.onWaitlist).toBe(true);
    expect(wl.message?.text).toMatch(/#2 on the waitlist/);
    expect(rehearseLeaveWaitlist(wl.sim).sim.onWaitlist).toBe(false);
  });

  it('closed events say why, in the real words', () => {
    const cases: Array<[Partial<EventDetails['event']>, RegExp]> = [
      [{ status: 'cancelled' }, /cancelled/],
      [{ start_datetime: iso(-3), end_datetime: iso(-1) }, /over/],
      [{ rsvp_closed: true }, /./],
    ];
    for (const [over, re] of cases) {
      const out = rehearseRsvp(REHEARSAL_START, 'going', viewOf(real(over), REHEARSAL_START));
      expect(out.sim.rsvp).toBeNull();
      expect(out.message?.tone).toBe('error');
      expect(out.message?.text).toMatch(re);
    }
  });

  it('interested, then leave', () => {
    const r = real();
    const i = rehearseRsvp(REHEARSAL_START, 'interested', viewOf(r, REHEARSAL_START));
    expect(i.sim.rsvp).toBe('interested');
    expect(rehearseLeave(i.sim).sim.rsvp).toBeNull();
  });

  it('series date chips follow the real override rule', () => {
    const going = rehearseDate(REHEARSAL_START, '2026-11-24', 'none');
    expect(going.sim.dateOverrides).toEqual([{ occurrence_date: '2026-11-24', status: 'going' }]);
    // Tapping again clears back to the series default (not going).
    expect(rehearseDate(going.sim, '2026-11-24', 'going').sim.dateOverrides).toEqual([]);
    // A series goer opting out of one date.
    const seriesGoer = { ...REHEARSAL_START, rsvp: 'going' as const };
    expect(rehearseDate(seriesGoer, '2026-11-24', 'going').sim.dateOverrides).toEqual([
      { occurrence_date: '2026-11-24', status: 'not_going' },
    ]);
  });
});

describe('Phase 3 scenarios', () => {
  // "now" (the real clock) is 2026-11-17 12:00Z; the one-off is tomorrow 12:00–14:00.
  const atScenario = (r: EventDetails, when: Parameters<typeof scenarioNow>[2], sim = REHEARSAL_START, spots: 'real' | 'open' | 'full' = 'real') =>
    deriveEventViewer({ details: rehearsalDetails(r, sim, spots), userId: 'host', userBusinessId: null, now: scenarioNow(r.event, [], when, now) });

  it('each "when" puts a one-off in the intended state', () => {
    const r = real();
    expect(atScenario(r, 'before').live || atScenario(r, 'before').ended).toBe(false);
    expect(atScenario(r, 'dayof').live).toBe(false);
    expect(atScenario(r, 'live').live).toBe(true);
    expect(atScenario(r, 'ended').ended).toBe(true);
    // The real clock is the default.
    expect(scenarioNow(r.event, [], 'real', now)).toBe(now);
  });

  it('a series is shown live on its next date, and ended after its end date', () => {
    const series = real({
      start_datetime: '2026-11-03T18:00:00.000Z', end_datetime: '2026-11-03T20:00:00.000Z',
      is_recurring: true, recurrence_pattern: { frequency: 'weekly', interval: 1, endDate: '2026-12-15' }, timezone: 'UTC',
    });
    const live = atScenario(series, 'live');
    expect(live.live).toBe(true);
    expect(live.liveOccurrence?.dateKey).toBe('2026-11-17');
    expect(atScenario(series, 'ended').ended).toBe(true);
  });

  it('"Ended" is not offered for an open-ended series; "Happening now" not for a cancelled event', () => {
    const open = real({ is_recurring: true, recurrence_pattern: { frequency: 'weekly', interval: 1 }, timezone: 'UTC' });
    expect(scenarioOptions(open.event)).not.toContain('ended');
    expect(scenarioOptions(real({ status: 'cancelled' }).event)).not.toContain('live');
    expect(scenarioOptions(real().event)).toEqual(['real', 'before', 'dayof', 'live', 'ended']);
  });

  it('join, then "Ended": the guest attended', () => {
    const r = real();
    const joined = rehearseRsvp(REHEARSAL_START, 'going', atScenario(r, 'real')).sim;
    const after = atScenario(r, 'ended', joined);
    expect(after.ended && after.hasJoined).toBe(true);
    // …and can no longer join or leave once it is over.
    expect(rehearseRsvp(REHEARSAL_START, 'going', after).message?.text).toMatch(/over/);
  });

  it('"Full" fills every seat, inventing a limit when there is none', () => {
    const v = atScenario(real(), 'real', REHEARSAL_START, 'full');
    expect(v.full).toBe(true);
    expect(v.maxAttendees).toBe(3);
    // The guest already in keeps their seat.
    const inside = atScenario(real(), 'real', { ...REHEARSAL_START, rsvp: 'going' }, 'full');
    expect(inside.full).toBe(false);
  });

  it('"Spots left" frees one seat on a full event', () => {
    const full = real({ max_attendees: 3 });
    expect(atScenario(full, 'real').full).toBe(true);
    expect(atScenario(full, 'real', REHEARSAL_START, 'open').full).toBe(false);
  });
});
