import { describe, expect, it } from 'vitest';
import { planBMoments } from '@/utils/planBMoments';
import type { OccurrenceException, DateRsvpOverride } from '@/utils/occurrences';

const H = 60 * 60 * 1000;
const NOW = new Date('2026-12-05T15:00:00.000Z');
const iso = (h: number) => new Date(NOW.getTime() + h * H).toISOString();

type Over = Record<string, unknown>;
function details(event: Over = {}, top: Over = {}) {
  return {
    event: {
      id: 'ev-1',
      business_id: 'biz-1',
      category_id: 'cat-music',
      title: 'Gig',
      start_datetime: iso(5),
      end_datetime: iso(8),
      lat: 40.7,
      lng: -74,
      status: 'active',
      publish_state: 'published',
      visibility: 'public',
      is_recurring: false,
      recurrence_pattern: null,
      max_attendees: null,
      rsvp_mode: 'open',
      waitlist_mode: 'notify',
      timezone: 'UTC',
      ...event,
    },
    rsvp_count: 3,
    user_rsvp: null,
    waitlist: undefined,
    category: { label: 'Live music' },
    ...top,
  } as never;
}

const run = (
  d: ReturnType<typeof details>,
  o: { userId?: string | null; userBusinessId?: string | null; exceptions?: OccurrenceException[]; overrides?: DateRsvpOverride[]; now?: Date; enabled?: boolean } = {}
) =>
  planBMoments({
    details: d,
    userId: o.userId === undefined ? 'user-1' : o.userId,
    userBusinessId: o.userBusinessId ?? null,
    exceptions: o.exceptions ?? [],
    dateOverrides: o.overrides ?? [],
    now: o.now ?? NOW,
    enabled: o.enabled ?? true,
  });

describe('planBMoments — who never gets Plan B', () => {
  it('the host, the rehearsal preview (disabled) and drafts', () => {
    const cancelled = details({ status: 'cancelled' });
    expect(run(cancelled, { userBusinessId: 'biz-1' }).page).toBeNull();
    expect(run(cancelled, { enabled: false }).page).toBeNull();
    expect(run(details({ status: 'cancelled', publish_state: 'draft' })).page).toBeNull();
  });
});

describe('T1 cancelled', () => {
  it('a cancelled one-off still ahead: anchor on its own times', () => {
    const m = run(details({ status: 'cancelled' }));
    expect(m.page?.reason).toBe('cancelled');
    expect(m.page?.start.toISOString()).toBe(iso(5));
    expect(m.page?.categoryLabel).toBe('Live music');
  });

  it('shown to signed-out visitors too (nothing personal in it)', () => {
    expect(run(details({ status: 'cancelled' }), { userId: null }).page?.reason).toBe('cancelled');
  });

  it('nothing once the evening it was for is over', () => {
    expect(run(details({ status: 'cancelled', start_datetime: iso(-6), end_datetime: iso(-3) })).page).toBeNull();
  });
});

describe('T3 full', () => {
  it('full and not going: anchor', () => {
    expect(run(details({ max_attendees: 3 }, { rsvp_count: 3 })).page?.reason).toBe('full');
  });

  it('waitlisted: still offered, as a backup', () => {
    const m = run(details({ max_attendees: 3 }, { rsvp_count: 3, waitlist: { position: 2, count: 4 } }));
    expect(m.page?.reason).toBe('full');
  });

  it('not when going, not when there is room, not when postponed or over', () => {
    expect(run(details({ max_attendees: 3 }, { rsvp_count: 3, user_rsvp: 'going' })).page).toBeNull();
    expect(run(details({ max_attendees: 5 }, { rsvp_count: 3 })).page).toBeNull();
    expect(run(details({ max_attendees: 3, status: 'postponed' }, { rsvp_count: 3 })).page).toBeNull();
    expect(
      run(details({ max_attendees: 3, start_datetime: iso(-5), end_datetime: iso(-2) }, { rsvp_count: 3 })).page
    ).toBeNull();
  });
});

describe('T2 a cancelled series date', () => {
  // Weekly Saturdays 20:00 UTC; 2026-12-05 is a Saturday.
  const series = (over: Over = {}, top: Over = {}) =>
    details(
      {
        is_recurring: true,
        recurrence_pattern: { frequency: 'weekly', interval: 1 },
        start_datetime: '2026-11-07T20:00:00.000Z',
        end_datetime: '2026-11-07T23:00:00.000Z',
        ...over,
      },
      { user_rsvp: 'going', ...top }
    );
  const skipTonight: OccurrenceException = {
    event_id: 'ev-1',
    occurrence_date: '2026-12-05',
    kind: 'cancelled',
    new_start: null,
    new_end: null,
    note: null,
  };

  it('series goer, tonight skipped: anchor on that date', () => {
    const m = run(series(), { exceptions: [skipTonight] });
    expect(m.date?.anchor.reason).toBe('date_cancelled');
    expect(m.date?.anchor.dateKey).toBe('2026-12-05');
    expect(m.date?.start.toISOString()).toBe('2026-12-05T20:00:00.000Z');
  });

  it('date-only goer of that date: anchor', () => {
    const m = run(series({}, { user_rsvp: null }), {
      exceptions: [skipTonight],
      overrides: [{ occurrence_date: '2026-12-05', status: 'going' }],
    });
    expect(m.date?.anchor.dateKey).toBe('2026-12-05');
  });

  it('not for someone who had said they cannot go, nor a non-attendee, nor signed out', () => {
    expect(
      run(series(), { exceptions: [skipTonight], overrides: [{ occurrence_date: '2026-12-05', status: 'not_going' }] }).date
    ).toBeNull();
    expect(run(series({}, { user_rsvp: null }), { exceptions: [skipTonight] }).date).toBeNull();
    expect(run(series(), { exceptions: [skipTonight], userId: null }).date).toBeNull();
  });

  it('no cancelled date: nothing', () => {
    expect(run(series()).date).toBeNull();
  });
});

describe('T5 "Can\'t make it?"', () => {
  it('going, starts in 20 min: offered', () => {
    const m = run(details({ start_datetime: iso(1 / 3), end_datetime: iso(3) }, { user_rsvp: 'going' }));
    expect(m.late?.anchor.reason).toBe('late');
    expect(m.late?.seriesDateKey).toBeNull();
  });

  it('going, on now: offered', () => {
    expect(run(details({ start_datetime: iso(-1), end_datetime: iso(1) }, { user_rsvp: 'going' })).late).not.toBeNull();
  });

  it('not 45 min ahead, not for non-goers, not once over or cancelled', () => {
    expect(run(details({ start_datetime: iso(0.75), end_datetime: iso(3) }, { user_rsvp: 'going' })).late).toBeNull();
    expect(run(details({ start_datetime: iso(0.25), end_datetime: iso(3) }, { user_rsvp: 'interested' })).late).toBeNull();
    expect(run(details({ start_datetime: iso(-3), end_datetime: iso(-1) }, { user_rsvp: 'going' })).late).toBeNull();
    expect(
      run(details({ start_datetime: iso(0.25), end_datetime: iso(3), status: 'cancelled' }, { user_rsvp: 'going' })).late
    ).toBeNull();
  });

  it('a series: the running date, only if the viewer attends that date', () => {
    const live = details(
      {
        is_recurring: true,
        recurrence_pattern: { frequency: 'weekly', interval: 1 },
        start_datetime: '2026-11-07T14:00:00.000Z',
        end_datetime: '2026-11-07T17:00:00.000Z',
      },
      { user_rsvp: 'going' }
    );
    const m = run(live);
    expect(m.late?.seriesDateKey).toBe('2026-12-05');
    expect(run(live, { overrides: [{ occurrence_date: '2026-12-05', status: 'not_going' }] }).late).toBeNull();
  });
});
