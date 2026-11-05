import { describe, expect, it } from 'vitest';
import {
  announcementReadRate,
  deltaVsMedian,
  describeRsvpChanges,
  dropOffRate,
  formatPercent,
  funnelSteps,
  interactionTotal,
  leadTimeSummary,
  parseEventInsights,
  trendMax,
} from '@/utils/analytics';

const freePayload = {
  tier: 'free',
  period_days: 30,
  event: { id: 'e1', title: 'Gallery night', start_datetime: '2026-11-06T19:00:00Z', timezone: 'Europe/Lisbon', status: 'active', max_attendees: 4, is_recurring: false, rsvp_mode: 'open' },
  totals: { views: 3, unique_viewers: 2, views_period: 2, saves: 1, saves_period: 1, going: 2, going_period: 2, interested: 0, requested: 0, waitlist: 0, removed: 0, fill_rate: 0.5, view_to_save: 0.5, view_to_going: 1 },
  trend: null,
  lead_time: null,
  audience: null,
  announcements: null,
  chat: null,
  business_median: null,
};

describe('parseEventInsights', () => {
  it('maps the free payload and keeps premium sections null', () => {
    const p = parseEventInsights(freePayload);
    expect(p.tier).toBe('free');
    expect(p.totals).toMatchObject({ views: 3, uniqueViewers: 2, going: 2, fillRate: 0.5, viewToGoing: 1 });
    expect(p.event).toMatchObject({ title: 'Gallery night', maxAttendees: 4, timezone: 'Europe/Lisbon' });
    expect([p.trend, p.leadTime, p.audience, p.announcements, p.chat, p.businessMedian]).toEqual([null, null, null, null, null, null]);
    expect(p.source).toBe('insights_rpc');
  });

  it('maps premium sections', () => {
    const p = parseEventInsights({
      ...freePayload,
      tier: 'premium',
      trend: [{ date: '2026-11-01', views: 1, saves: 0, going: 1, going_cumulative: 1 }],
      lead_time: { available: true, same_day: 0, d1_3: 1, d4_7: 0, d8_14: 1, d15_plus: 0 },
      audience: { followers_going: 1, returning_going: 1, first_time_going: 1 },
      announcements: { sent: 1, recipients: 2, read: 1 },
      chat: { messages: 4, active_senders: 2, messages_period: 3 },
      business_median: { events: 5, views: 2.5, going: 1 },
    });
    expect(p.tier).toBe('premium');
    expect(p.trend).toEqual([{ date: '2026-11-01', views: 1, saves: 0, going: 1, goingCumulative: 1 }]);
    expect(p.leadTime).toEqual({ available: true, sameDay: 0, d1to3: 1, d4to7: 0, d8to14: 1, d15plus: 0 });
    expect(p.businessMedian).toEqual({ events: 5, views: 2.5, going: 1 });
  });

  it('keeps the reason when lead time is unavailable', () => {
    const p = parseEventInsights({ ...freePayload, tier: 'premium', lead_time: { available: false, reason: 'recurring' } });
    expect(p.leadTime).toEqual({ available: false, reason: 'recurring' });
  });

  it('survives junk without throwing', () => {
    const p = parseEventInsights({ totals: { views: 'abc', fill_rate: 'x' }, trend: 'nope' });
    expect(p.totals.views).toBe(0);
    expect(p.totals.fillRate).toBeNull();
    expect(p.trend).toBeNull();
    expect(parseEventInsights(null).tier).toBe('free');
  });
});

describe('formatting and ratios', () => {
  it('formats percentages', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.004)).toBe('<1%');
    expect(formatPercent(0.425)).toBe('43%');
    expect(formatPercent(1.2)).toBe('120%');
    expect(formatPercent(Number.NaN)).toBe('0%');
  });

  it('builds the funnel against unique viewers', () => {
    expect(funnelSteps({ uniqueViewers: 4, saves: 2, going: 1 }).map((s) => [s.key, s.value, s.ratioOfFirst])).toEqual([
      ['views', 4, 1],
      ['saves', 2, 0.5],
      ['going', 1, 0.25],
    ]);
    expect(funnelSteps({ uniqueViewers: 0, saves: 1, going: 1 }).every((s) => s.ratioOfFirst === 0)).toBe(true);
  });

  it('summarises lead time with a reading', () => {
    const s = leadTimeSummary({ available: true, sameDay: 0, d1to3: 3, d4to7: 1, d8to14: 0, d15plus: 0 });
    expect(s.total).toBe(4);
    expect(s.reading).toBe('Most people RSVP 1–3 days before');
    expect(s.buckets[1].share).toBe(0.75);
    expect(leadTimeSummary({ available: true, sameDay: 2, d1to3: 0, d4to7: 0, d8to14: 0, d15plus: 0 }).reading).toBe(
      'Most people RSVP on the day itself'
    );
    expect(leadTimeSummary({ available: true, sameDay: 0, d1to3: 0, d4to7: 0, d8to14: 0, d15plus: 0 }).reading).toBeNull();
  });

  it('compares against the business median', () => {
    expect(deltaVsMedian(10, null)).toBeNull();
    expect(deltaVsMedian(0, 0)).toBeNull();
    expect(deltaVsMedian(3, 0)).toEqual({ direction: 'up', label: 'Above your usual' });
    expect(deltaVsMedian(10, 10)).toEqual({ direction: 'same', label: 'About your usual' });
    expect(deltaVsMedian(25, 10)).toEqual({ direction: 'up', label: '2.5× your usual' });
    expect(deltaVsMedian(14, 10)).toEqual({ direction: 'up', label: '40% above your usual' });
    expect(deltaVsMedian(6, 10)).toEqual({ direction: 'down', label: '40% below your usual' });
  });

  it('guards bar scaling and read rate', () => {
    expect(trendMax([], (p: { v: number }) => p.v)).toBe(1);
    expect(trendMax([{ v: 2 }, { v: 7 }], (p) => p.v)).toBe(7);
    expect(announcementReadRate({ recipients: 0, read: 0 })).toBe(0);
    expect(announcementReadRate({ recipients: 4, read: 1 })).toBe(0.25);
  });
});

describe('taps and RSVP changes', () => {
  it('parses both sections and keeps them null on free', () => {
    const p = parseEventInsights({
      tier: 'premium',
      interactions: { share: 2, ticket: 1, calendar: 3, directions: 0, period: 4 },
      rsvp_changes: { tracked_since: '2026-11-01T10:00:00Z', joined: 4, left: 1, downgraded: 1, declined: 2, removed: 0 },
    });
    expect(p.interactions).toEqual({ share: 2, ticket: 1, calendar: 3, directions: 0, period: 4 });
    expect(p.rsvpChanges).toMatchObject({ trackedSince: '2026-11-01T10:00:00Z', joined: 4, left: 1, downgraded: 1 });
    expect(interactionTotal(p.interactions!)).toBe(6);
    const free = parseEventInsights({ tier: 'free', interactions: null, rsvp_changes: null });
    expect([free.interactions, free.rsvpChanges]).toEqual([null, null]);
  });

  it('describes drift in plain words and leaves host decisions out', () => {
    const base = { trackedSince: null, joined: 0, left: 0, downgraded: 0, declined: 3, removed: 1 };
    expect(describeRsvpChanges(base, 30)).toBeNull();
    expect(describeRsvpChanges({ ...base, joined: 3 }, 30)).toBe('3 joined in the last 30 days');
    expect(describeRsvpChanges({ ...base, joined: 3, left: 1, downgraded: 1 }, 7)).toBe(
      '3 joined, 1 left and 1 switched to interested in the last 7 days'
    );
  });

  it('computes a bounded drop-off rate', () => {
    const base = { trackedSince: null, joined: 0, left: 0, downgraded: 0, declined: 0, removed: 0 };
    expect(dropOffRate(base)).toBeNull();
    expect(dropOffRate({ ...base, joined: 4, left: 1 })).toBe(0.25);
    expect(dropOffRate({ ...base, joined: 1, left: 2, downgraded: 1 })).toBe(1);
  });
});
