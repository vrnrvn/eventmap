import { describe, expect, it } from 'vitest';
import { parseHostDashboardRpc } from '@/utils/hostDashboardRpc';
import { buildAgenda, buildAttentionQueue } from '@/utils/hostDashboard';
import type { Event } from '@/types/database';

const ev = (over: Partial<Event>): Event =>
  ({
    id: 'e1', business_id: 'b1', title: 'Market', status: 'active', publish_state: 'published',
    is_recurring: false, recurrence_pattern: null, timezone: 'UTC', rsvp_mode: 'approval', max_attendees: 100,
    start_datetime: '2026-11-20T10:00:00.000Z', end_datetime: '2026-11-20T14:00:00.000Z',
    ...over,
  }) as unknown as Event;

describe('parseHostDashboardRpc', () => {
  it('maps every field onto the N-call shapes', () => {
    const out = parseHostDashboardRpc({
      events: [ev({})],
      drafts: [ev({ id: 'd1', publish_state: 'draft' })],
      counts: { e1: { going: '12', waitlist: 3 } },
      exceptions: [{ event_id: 's1', occurrence_date: '2026-11-21', kind: 'cancelled', new_start: null, new_end: null, note: 'x' }],
      overviews: { e1: { requested: 4, waitlist: 3, chat: { open_reports: 1 } } },
      date_going: { s1: { '2026-11-22': '7' } },
      inspected: 1, eligible: 2, truncated: true,
    });
    expect(out.data).toMatchObject({
      counts: { e1: { going: 12, waitlist: 3 } },
      dateGoing: { s1: { '2026-11-22': 7 } },
      truncated: true, countsUnavailable: false, source: 'rpc',
    });
    expect(out.data.events.map((e) => e.id)).toEqual(['e1']);
    expect(out.data.exceptions[0].occurrence_date).toBe('2026-11-21');
    expect(out.attention).toEqual({
      drafts: [expect.objectContaining({ id: 'd1' })],
      overviews: { e1: { requested: 4, waitlist: 3, chat: { open_reports: 1 } } },
      inspected: 1, eligible: 2,
    });
  });

  it('tolerates empty aggregates (json_agg of nothing is null)', () => {
    const out = parseHostDashboardRpc({ events: null, counts: null, exceptions: null, date_going: null });
    expect(out.data).toMatchObject({ events: [], counts: {}, exceptions: [], dateGoing: {}, truncated: false });
    expect(out.attention).toEqual({ drafts: [], overviews: {}, inspected: 0, eligible: 0 });
  });

  it('keeps unknown overview facts as null, not 0', () => {
    const out = parseHostDashboardRpc({ overviews: { e1: { requested: null, chat: null } } });
    expect(out.attention.overviews.e1).toEqual({ requested: null, waitlist: null, chat: { open_reports: null } });
  });

  it('feeds buildAgenda and buildAttentionQueue unchanged', () => {
    const now = new Date('2026-11-19T12:00:00.000Z');
    const { data, attention } = parseHostDashboardRpc({
      events: [ev({})],
      counts: { e1: { going: 12, waitlist: 0 } },
      overviews: { e1: { requested: 4, waitlist: 0, chat: { open_reports: 0 } } },
    });
    const days = buildAgenda({ events: data.events, counts: data.counts, exceptions: data.exceptions, dateGoing: data.dateGoing, now });
    expect(days.flatMap((d) => d.entries).length).toBeGreaterThan(0);
    const queue = buildAttentionQueue({ events: data.events, drafts: attention.drafts, counts: data.counts, overviews: attention.overviews, now });
    expect(queue.some((q) => q.kind === 'requests' && q.count === 4)).toBe(true);
  });
});
