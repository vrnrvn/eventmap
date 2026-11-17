import { describe, expect, it } from 'vitest';
import type { Event } from '@/types/database';
import type { OccurrenceException } from '@/utils/occurrences';
import type { RecurrencePattern } from '@/utils/recurrence';
import {
  dateActionsFor,
  AGENDA_DAYS,
  MAX_OVERVIEW_TARGETS,
  buildAttentionQueue,
  describeAttention,
  overviewTargets,
  agendaWindow,
  buildAgenda,
  describeAttendance,
  localDayKey,
  seriesDatesInAgenda,
  summarizeAgenda,
  todayCardCopy,
  type AgendaEntry,
} from '@/utils/hostDashboard';

/**
 * Host dashboard agenda (docs/HOST_DASHBOARD_PLAN.md C1). Timestamps are
 * local-naive ISO strings and events carry no zone unless a test says so, so
 * the suite means the same thing in any machine time zone.
 */

// Monday 16 Nov 2026, 12:00 local.
const NOW = new Date(2026, 10, 16, 12, 0, 0);
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

let seq = 0;
function event(overrides: Partial<Event> & { start: string; end?: string }): Event {
  const { start, end, ...rest } = overrides;
  seq += 1;
  return {
    id: `evt-${seq}`,
    business_id: 'biz-1',
    title: `Event ${seq}`,
    start_datetime: start,
    end_datetime: end ?? new Date(new Date(start).getTime() + 2 * 3600_000).toISOString(),
    status: 'active',
    publish_state: 'published',
    is_recurring: false,
    recurrence_pattern: null,
    timezone: null,
    ...rest,
  } as Event;
}

function series(pattern: RecurrencePattern, start: string, overrides: Partial<Event> = {}): Event {
  return event({ start, is_recurring: true, recurrence_pattern: pattern, ...overrides });
}

const all = (days: ReturnType<typeof buildAgenda>): AgendaEntry[] => days.flatMap((d) => d.entries);

describe('agendaWindow', () => {
  it('runs from the start of today for seven device days', () => {
    const { from, to } = agendaWindow(NOW);
    expect(from).toEqual(new Date(2026, 10, 16));
    expect(to).toEqual(new Date(2026, 10, 23));
    expect(AGENDA_DAYS).toBe(7);
  });

  it('keeps whole days across a DST change', () => {
    // 1 Nov 2026 is the US fall-back day; component arithmetic keeps midnight.
    const { from, to } = agendaWindow(new Date(2026, 9, 30, 9));
    expect(to.getHours()).toBe(0);
    expect(to.getDate()).toBe(new Date(2026, 10, 6).getDate());
    expect(from.getHours()).toBe(0);
  });
});

describe('one-off events', () => {
  it('lists today, tomorrow and later in the window, grouped by day', () => {
    const today = event({ title: 'Today', start: local(2026, 11, 16, 19) });
    const tomorrow = event({ title: 'Tomorrow', start: local(2026, 11, 17, 10) });
    const sunday = event({ title: 'Sunday', start: local(2026, 11, 22, 23, 30) });
    const days = buildAgenda({ events: [sunday, tomorrow, today], counts: {}, exceptions: [], now: NOW });

    expect(days.map((d) => [d.key, d.relative, d.entries.map((e) => e.title)])).toEqual([
      ['2026-11-16', 'today', ['Today']],
      ['2026-11-17', 'tomorrow', ['Tomorrow']],
      ['2026-11-22', null, ['Sunday']],
    ]);
  });

  it('drops events outside the window and events that are over', () => {
    const nextMonday = event({ start: local(2026, 11, 23, 0, 0) }); // first instant after the window
    const finished = event({ start: local(2026, 11, 16, 8), end: local(2026, 11, 16, 10) });
    expect(all(buildAgenda({ events: [nextMonday, finished], counts: {}, exceptions: [], now: NOW }))).toEqual([]);
  });

  it('marks an event in progress as live and keeps it under today, even if it began yesterday', () => {
    const overnight = event({ start: local(2026, 11, 15, 22), end: local(2026, 11, 16, 14) });
    const [day] = buildAgenda({ events: [overnight], counts: {}, exceptions: [], now: NOW });
    expect(day.relative).toBe('today');
    expect(day.entries[0].status).toBe('live');
  });

  it('leaves out cancelled, postponed and draft events', () => {
    const events = [
      event({ start: local(2026, 11, 17, 19), status: 'cancelled' }),
      event({ start: local(2026, 11, 17, 19), status: 'postponed' }),
      event({ start: local(2026, 11, 17, 19), publish_state: 'draft' }),
    ];
    expect(all(buildAgenda({ events, counts: {}, exceptions: [], now: NOW }))).toEqual([]);
  });

  it('carries going, capacity and waitlist from the batched counts', () => {
    const e = event({ start: local(2026, 11, 18, 10), max_attendees: 150 });
    const [entry] = all(buildAgenda({ events: [e], counts: { [e.id]: { going: 112, waitlist: 3 } }, exceptions: [], now: NOW }));
    expect(entry).toMatchObject({ going: 112, goingScope: 'event', capacity: 150, waitlist: 3, isSeries: false, dateKey: null });
    expect(describeAttendance(entry)).toBe('112 / 150 going · 3 waiting');
  });

  it('renders with unknown counts', () => {
    const e = event({ start: local(2026, 11, 18, 10) });
    const [entry] = all(buildAgenda({ events: [e], counts: {}, exceptions: [], now: NOW }));
    expect(entry.going).toBeNull();
    expect(entry.goingScope).toBeNull();
    expect(describeAttendance(entry)).toBeNull();
  });
});

describe('series', () => {
  it('expands a weekly series into each date it happens in the window', () => {
    // Thursdays and Saturdays, from September.
    const s = series({ frequency: 'weekly', interval: 1, byWeekday: [4, 6] }, local(2026, 9, 3, 19));
    const entries = all(buildAgenda({ events: [s], counts: {}, exceptions: [], now: NOW }));
    expect(entries.map((e) => e.dateKey)).toEqual(['2026-11-19', '2026-11-21']);
    expect(entries.every((e) => e.isSeries && e.start.getHours() === 19)).toBe(true);
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
  });

  it('a daily series fills every remaining day, including tonight but not this morning', () => {
    const morning = series({ frequency: 'daily', interval: 1 }, local(2026, 1, 1, 8));
    const evening = series({ frequency: 'daily', interval: 1 }, local(2026, 1, 1, 19));
    const days = buildAgenda({ events: [morning, evening], counts: {}, exceptions: [], now: NOW });
    const keysFor = (id: string) => all(days).filter((e) => e.eventId === id).map((e) => e.dateKey);
    // 08:00 today is over at 12:00; the six following mornings remain.
    expect(keysFor(morning.id)).toHaveLength(6);
    expect(keysFor(morning.id)[0]).toBe('2026-11-17');
    expect(keysFor(evening.id)).toHaveLength(7);
    expect(keysFor(evening.id)[0]).toBe('2026-11-16');
  });

  it('keeps a skipped date in place, marked cancelled, with nobody going (DC4)', () => {
    const s = series({ frequency: 'weekly', interval: 1 }, local(2026, 10, 1, 19)); // Thursdays
    const skip: OccurrenceException = {
      event_id: s.id,
      occurrence_date: '2026-11-19',
      kind: 'cancelled',
      new_start: null,
      new_end: null,
      note: 'Venue closed',
    };
    const [entry] = all(buildAgenda({ events: [s], counts: { [s.id]: { going: 30, waitlist: 2 } }, exceptions: [skip], now: NOW }));
    expect(entry).toMatchObject({ dateKey: '2026-11-19', status: 'cancelled', going: null, waitlist: null, note: 'Venue closed' });
    expect(describeAttendance(entry)).toBe('Skipped');
  });

  it('shows a moved date at its new time, and drops one moved out of the window', () => {
    const s = series({ frequency: 'weekly', interval: 1 }, local(2026, 10, 1, 19)); // Thursdays
    const movedLater: OccurrenceException = {
      event_id: s.id,
      occurrence_date: '2026-11-19',
      kind: 'rescheduled',
      new_start: local(2026, 11, 20, 20),
      new_end: local(2026, 11, 20, 22),
      note: null,
    };
    const [entry] = all(buildAgenda({ events: [s], counts: {}, exceptions: [movedLater], now: NOW }));
    expect(entry.status).toBe('moved');
    expect(entry.dateKey).toBe('2026-11-19'); // keyed by the original date, as the server is
    expect(localDayKey(entry.start)).toBe('2026-11-20');

    const movedOut: OccurrenceException = { ...movedLater, new_start: local(2026, 12, 3, 20), new_end: local(2026, 12, 3, 22) };
    expect(all(buildAgenda({ events: [s], counts: {}, exceptions: [movedOut], now: NOW }))).toEqual([]);
  });

  it('prefers the per-date going count and says which one it used', () => {
    const s = series({ frequency: 'weekly', interval: 1 }, local(2026, 10, 1, 19));
    const days = buildAgenda({
      events: [s],
      counts: { [s.id]: { going: 40, waitlist: null } },
      exceptions: [],
      dateGoing: { [s.id]: { '2026-11-19': 28 } },
      now: NOW,
    });
    expect(all(days)[0]).toMatchObject({ going: 28, goingScope: 'date' });

    const fallback = buildAgenda({ events: [s], counts: { [s.id]: { going: 40, waitlist: null } }, exceptions: [], now: NOW });
    expect(all(fallback)[0]).toMatchObject({ going: 40, goingScope: 'series' });
  });

  it('leaves out a series whose end date has passed or that ends before the window', () => {
    const ended = series({ frequency: 'weekly', interval: 1, endDate: '2026-11-01' }, local(2026, 9, 1, 19));
    const endsToday = series({ frequency: 'daily', interval: 1, endDate: '2026-11-16' }, local(2026, 11, 1, 19));
    const entries = all(buildAgenda({ events: [ended, endsToday], counts: {}, exceptions: [], now: NOW }));
    expect(entries.map((e) => [e.eventId, e.dateKey])).toEqual([[endsToday.id, '2026-11-16']]);
  });

  it('expands a zoned series on its own calendar and keeps its zone for display', () => {
    const s = series({ frequency: 'weekly', interval: 1 }, '2026-10-01T18:00:00Z', { timezone: 'UTC' });
    const entries = all(buildAgenda({ events: [s], counts: {}, exceptions: [], now: NOW }));
    expect(entries).toHaveLength(1);
    expect(entries[0].start.toISOString()).toBe('2026-11-19T18:00:00.000Z');
    expect(entries[0].timezone).toBe('UTC');
  });
});

describe('ordering', () => {
  it('sorts by start across one-offs and series, title breaking ties', () => {
    const b = event({ title: 'B', start: local(2026, 11, 17, 10) });
    const a = event({ title: 'A', start: local(2026, 11, 17, 10) });
    const s = series({ frequency: 'weekly', interval: 1 }, local(2026, 10, 6, 9), { title: 'Series' }); // Tuesdays 09:00
    const [tuesday] = buildAgenda({ events: [b, s, a], counts: {}, exceptions: [], now: NOW }).filter((d) => d.relative === 'tomorrow');
    expect(tuesday.entries.map((e) => e.title)).toEqual(['Series', 'A', 'B']);
  });
});

describe('summarizeAgenda', () => {
  it('counts today and the week, skipping skipped dates, and names the next item', () => {
    const today = event({ title: 'Tonight', start: local(2026, 11, 16, 19) });
    const later = event({ title: 'Later', start: local(2026, 11, 20, 19) });
    const s = series({ frequency: 'weekly', interval: 1 }, local(2026, 10, 1, 19)); // Thu 19 Nov
    const skip: OccurrenceException = { event_id: s.id, occurrence_date: '2026-11-19', kind: 'cancelled', new_start: null, new_end: null, note: null };
    const days = buildAgenda({
      events: [today, later, s],
      counts: { [today.id]: { going: 12, waitlist: null } },
      exceptions: [skip],
      now: NOW,
    });
    expect(summarizeAgenda(days)).toMatchObject({ today: 1, week: 2, goingToday: 12 });
    expect(summarizeAgenda(days).next?.title).toBe('Tonight');
  });

  it('is empty for an empty agenda', () => {
    expect(summarizeAgenda([])).toEqual({ today: 0, week: 0, goingToday: 0, next: null, nextDay: null });
  });
});

describe('seriesDatesInAgenda', () => {
  it('lists live series dates per series, soonest series first, capped', () => {
    const daily = series({ frequency: 'daily', interval: 1 }, local(2026, 1, 1, 19));
    const weekly = series({ frequency: 'weekly', interval: 1 }, local(2026, 10, 1, 19));
    const skip: OccurrenceException = { event_id: weekly.id, occurrence_date: '2026-11-19', kind: 'cancelled', new_start: null, new_end: null, note: null };
    const days = buildAgenda({ events: [daily, weekly], counts: {}, exceptions: [skip], now: NOW });

    const wanted = seriesDatesInAgenda(days);
    expect(wanted[daily.id]).toHaveLength(7);
    expect(wanted[weekly.id]).toBeUndefined(); // its only date is skipped

    expect(Object.keys(seriesDatesInAgenda(days, 0))).toEqual([]);
  });

  it('never asks for one-offs', () => {
    const days = buildAgenda({ events: [event({ start: local(2026, 11, 17, 10) })], counts: {}, exceptions: [], now: NOW });
    expect(seriesDatesInAgenda(days)).toEqual({});
  });
});

describe('describeAttendance wording', () => {
  it('says when a series date only has the whole-series count', () => {
    const s = series({ frequency: 'weekly', interval: 1 }, local(2026, 10, 1, 19));
    const [entry] = all(buildAgenda({ events: [s], counts: { [s.id]: { going: 40, waitlist: 2 } }, exceptions: [], now: NOW }));
    expect(describeAttendance(entry)).toBe('40 going to the series · 2 waiting');
    const [exact] = all(
      buildAgenda({ events: [s], counts: { [s.id]: { going: 40, waitlist: null } }, exceptions: [], dateGoing: { [s.id]: { '2026-11-19': 28 } }, now: NOW })
    );
    expect(describeAttendance(exact)).toBe('28 going');
  });
});

describe('todayCardCopy', () => {
  const fmt = (e: AgendaEntry) => `${e.start.getHours()}:00`;

  it('invites before the dashboard has ever loaded', () => {
    expect(todayCardCopy(null, fmt)).toEqual({ title: 'Your hosting week', detail: 'See today and the next 6 days across all your events' });
  });

  it('says so when the week is empty', () => {
    expect(todayCardCopy(summarizeAgenda([]), fmt).title).toBe('Nothing on this week');
  });

  it('counts today and the week and names the next item', () => {
    const tonight = event({ title: 'Salsa', start: local(2026, 11, 16, 19) });
    const later = event({ title: 'Market', start: local(2026, 11, 20, 10) });
    const days = buildAgenda({ events: [tonight, later], counts: {}, exceptions: [], now: NOW });
    expect(todayCardCopy(summarizeAgenda(days), fmt)).toEqual({ title: '1 today · 2 this week', detail: 'Next: 19:00 · Salsa' });
  });

  it('drops the today count when nothing is on today, and says when the next item is live', () => {
    const live = event({ title: 'Workshop', start: local(2026, 11, 16, 11), end: local(2026, 11, 16, 13) });
    expect(todayCardCopy(summarizeAgenda(buildAgenda({ events: [live], counts: {}, exceptions: [], now: NOW })), fmt).detail).toBe(
      'Happening now · Workshop'
    );
    const friday = event({ title: 'Market', start: local(2026, 11, 20, 10) });
    expect(todayCardCopy(summarizeAgenda(buildAgenda({ events: [friday], counts: {}, exceptions: [], now: NOW })), fmt).title).toBe(
      '1 this week'
    );
  });

  it('names the day of the next item unless it is today', () => {
    const tomorrow = event({ title: 'Yoga', start: local(2026, 11, 17, 12) });
    const friday = event({ title: 'Market', start: local(2026, 11, 20, 10) });
    const copy = (events: Event[]) =>
      todayCardCopy(summarizeAgenda(buildAgenda({ events, counts: {}, exceptions: [], now: NOW })), fmt, () => 'Fri').detail;
    expect(copy([tomorrow])).toBe('Next: Tomorrow 12:00 · Yoga');
    expect(copy([friday])).toBe('Next: Fri 10:00 · Market');
  });
});

/* ───────────────────────── Needs attention (C2) ───────────────────────── */

const queue = (input: Partial<Parameters<typeof buildAttentionQueue>[0]> & { events: Event[] }) =>
  buildAttentionQueue({ counts: {}, now: NOW, ...input });

describe('buildAttentionQueue rules', () => {
  it('chat reports, from an inspected event only', () => {
    const e = event({ start: local(2026, 11, 18, 19) });
    const overview = { requested: 0, waitlist: 0, chat: { open_reports: 2 } };
    expect(queue({ events: [e], overviews: { [e.id]: overview } })[0]).toMatchObject({
      kind: 'chat_reports',
      count: 2,
      severity: 'action',
      target: { screen: 'manage', tab: 'chat' },
    });
    // Not inspected (beyond the cap): no claim is made.
    expect(queue({ events: [e] })).toEqual([]);
  });

  it('join requests only under approval mode', () => {
    const approval = event({ start: local(2026, 11, 18, 19), rsvp_mode: 'approval' });
    const open = event({ start: local(2026, 11, 18, 19), rsvp_mode: 'open' });
    const overview = { requested: 4, waitlist: 0, chat: null };
    expect(queue({ events: [approval], overviews: { [approval.id]: overview } })[0]).toMatchObject({
      kind: 'requests',
      count: 4,
      target: { screen: 'manage', tab: 'attendees', seg: 'requested' },
    });
    expect(queue({ events: [open], overviews: { [open.id]: overview } })).toEqual([]);
  });

  it('a postponed event asks for a new date and suppresses its other rules', () => {
    const e = event({ start: local(2026, 11, 18, 19), status: 'postponed', max_attendees: 10, waitlist_mode: 'off' });
    const items = queue({ events: [e], counts: { [e.id]: { going: 10, waitlist: 2 } } });
    expect(items.map((i) => i.kind)).toEqual(['postponed']);
    expect(items[0]).toMatchObject({ severity: 'action', target: { screen: 'manage', tab: 'settings' } });
  });

  it('waitlist: only when there is room and the mode is not automatic', () => {
    const base = { start: local(2026, 11, 18, 19), max_attendees: 20 };
    const roomy = event({ ...base });
    const auto = event({ ...base, waitlist_mode: 'auto' });
    const full = event({ ...base });
    expect(queue({ events: [roomy], counts: { [roomy.id]: { going: 12, waitlist: 4 } } })[0]).toMatchObject({
      kind: 'waitlist',
      count: 4,
      target: { screen: 'manage', tab: 'attendees', seg: 'waitlist' },
    });
    expect(queue({ events: [auto], counts: { [auto.id]: { going: 12, waitlist: 4 } } })).toEqual([]);
    // At capacity there is nobody to promote (the "full" rule covers it instead).
    expect(queue({ events: [full], counts: { [full.id]: { going: 20, waitlist: 4 } } }).map((i) => i.kind)).toEqual([]);
  });

  it('uncapped events can always promote from the waitlist', () => {
    const e = event({ start: local(2026, 11, 18, 19) });
    expect(queue({ events: [e], counts: { [e.id]: { going: 99, waitlist: 1 } } })[0]).toMatchObject({ kind: 'waitlist', count: 1 });
  });

  it('RSVPs switched off shortly before the start, with nobody going', () => {
    const soon = event({ start: local(2026, 11, 17, 10), rsvp_closed: true });
    const far = event({ start: local(2026, 11, 22, 10), rsvp_closed: true });
    const soonWithGuests = event({ start: local(2026, 11, 17, 10), rsvp_closed: true });
    expect(queue({ events: [soon] })[0]).toMatchObject({ kind: 'closed_soon', severity: 'suggestion', target: { screen: 'manage', tab: 'settings' } });
    expect(queue({ events: [far] })).toEqual([]);
    expect(queue({ events: [soonWithGuests], counts: { [soonWithGuests.id]: { going: 3, waitlist: null } } })).toEqual([]);
  });

  it('full with no waitlist is a suggestion', () => {
    const e = event({ start: local(2026, 11, 18, 19), max_attendees: 30, waitlist_mode: 'off' });
    expect(queue({ events: [e], counts: { [e.id]: { going: 30, waitlist: 0 } } })[0]).toMatchObject({
      kind: 'just_filled',
      count: 30,
      severity: 'suggestion',
    });
    const notifies = event({ start: local(2026, 11, 18, 19), max_attendees: 30 });
    expect(queue({ events: [notifies], counts: { [notifies.id]: { going: 30, waitlist: 0 } } })).toEqual([]);
  });

  it('stale drafts: older than three days, still in the future', () => {
    const stale = event({ start: local(2026, 11, 25, 19), publish_state: 'draft', updated_at: local(2026, 11, 10, 9) });
    const fresh = event({ start: local(2026, 11, 25, 19), publish_state: 'draft', updated_at: local(2026, 11, 15, 9) });
    const past = event({ start: local(2026, 11, 10, 19), publish_state: 'draft', updated_at: local(2026, 11, 1, 9) });
    expect(queue({ events: [], drafts: [stale] })[0]).toMatchObject({ kind: 'stale_draft', target: { screen: 'edit' } });
    expect(queue({ events: [], drafts: [fresh] })).toEqual([]);
    expect(queue({ events: [], drafts: [past] })).toEqual([]);
  });

  it('ignores cancelled and finished events', () => {
    const cancelled = event({ start: local(2026, 11, 18, 19), status: 'cancelled' });
    const ended = series({ frequency: 'weekly', interval: 1, endDate: '2026-11-01' }, local(2026, 9, 1, 19));
    const overviews = { [cancelled.id]: { requested: 0, waitlist: 0, chat: { open_reports: 5 } }, [ended.id]: { requested: 0, waitlist: 0, chat: { open_reports: 5 } } };
    expect(queue({ events: [cancelled, ended], overviews })).toEqual([]);
  });
});

describe('buildAttentionQueue ordering', () => {
  it('sorts by urgency, then by size', () => {
    const reports = event({ title: 'Reports', start: local(2026, 11, 20, 19) });
    const requests = event({ title: 'Requests', start: local(2026, 11, 19, 19), rsvp_mode: 'approval' });
    const waitlistSmall = event({ title: 'Small', start: local(2026, 11, 18, 19) });
    const waitlistBig = event({ title: 'Big', start: local(2026, 11, 18, 19) });
    const items = queue({
      events: [waitlistSmall, waitlistBig, requests, reports],
      counts: { [waitlistSmall.id]: { going: 1, waitlist: 2 }, [waitlistBig.id]: { going: 1, waitlist: 9 } },
      overviews: {
        [reports.id]: { requested: 0, waitlist: 0, chat: { open_reports: 1 } },
        [requests.id]: { requested: 3, waitlist: 0, chat: null },
      },
    });
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ['chat_reports', 'Reports'],
      ['requests', 'Requests'],
      ['waitlist', 'Big'],
      ['waitlist', 'Small'],
    ]);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it('one event can raise several items', () => {
    const e = event({ start: local(2026, 11, 18, 19), rsvp_mode: 'approval' });
    const items = queue({
      events: [e],
      counts: { [e.id]: { going: 2, waitlist: 3 } },
      overviews: { [e.id]: { requested: 1, waitlist: 3, chat: { open_reports: 2 } } },
    });
    expect(items.map((i) => i.kind)).toEqual(['chat_reports', 'requests', 'waitlist']);
  });
});

describe('overviewTargets (DC5)', () => {
  it('puts approval-mode events first, then the soonest, capped at ten', () => {
    const approvalLate = event({ title: 'approval-late', start: local(2026, 12, 20, 19), rsvp_mode: 'approval' });
    const openSoon = event({ title: 'open-soon', start: local(2026, 11, 17, 19) });
    const openLater = event({ title: 'open-later', start: local(2026, 11, 19, 19) });
    const ids = overviewTargets([openLater, openSoon, approvalLate], NOW);
    expect(ids).toEqual([approvalLate.id, openSoon.id, openLater.id]);
    expect(overviewTargets([openLater, openSoon, approvalLate], NOW, 2)).toEqual([approvalLate.id, openSoon.id]);
    expect(MAX_OVERVIEW_TARGETS).toBe(10);
  });

  it('caps the fan-out and never inspects cancelled, draft or finished events', () => {
    const many = Array.from({ length: 25 }, (_, i) => event({ start: local(2026, 11, 17 + (i % 5), 19) }));
    expect(overviewTargets(many, NOW)).toHaveLength(10);
    const skipped = [
      event({ start: local(2026, 11, 18, 19), status: 'cancelled' }),
      event({ start: local(2026, 11, 18, 19), publish_state: 'draft' }),
      event({ start: local(2026, 11, 10, 19), end: local(2026, 11, 10, 21) }),
    ];
    expect(overviewTargets(skipped, NOW)).toEqual([]);
  });
});

describe('describeAttention', () => {
  it('reads naturally in singular and plural', () => {
    const e = event({ start: local(2026, 11, 18, 19), rsvp_mode: 'approval' });
    const one = queue({ events: [e], overviews: { [e.id]: { requested: 1, waitlist: 0, chat: { open_reports: 1 } } } });
    expect(one.map(describeAttention)).toEqual(['1 chat report', '1 request waiting']);
    const many = queue({ events: [e], overviews: { [e.id]: { requested: 4, waitlist: 0, chat: { open_reports: 2 } } } });
    expect(many.map(describeAttention)).toEqual(['2 chat reports', '4 requests waiting']);
  });
});

/* ─────────────────────── Per-date operations (C5) ─────────────────────── */

describe('dateActionsFor', () => {
  const weekly = () => series({ frequency: 'weekly', interval: 1 }, local(2026, 10, 1, 19)); // Thursdays 19:00

  it('a scheduled future series date can be moved or skipped', () => {
    const [entry] = all(buildAgenda({ events: [weekly()], counts: {}, exceptions: [], now: NOW }));
    expect(dateActionsFor(entry, NOW)).toEqual(['move', 'skip']);
  });

  it('a skipped or moved date can be restored while its original time is ahead', () => {
    const s = weekly();
    const skip: OccurrenceException = { event_id: s.id, occurrence_date: '2026-11-19', kind: 'cancelled', new_start: null, new_end: null, note: null };
    const [skipped] = all(buildAgenda({ events: [s], counts: {}, exceptions: [skip], now: NOW }));
    expect(dateActionsFor(skipped, NOW)).toEqual(['restore']);

    const move: OccurrenceException = { ...skip, kind: 'rescheduled', new_start: local(2026, 11, 20, 20), new_end: local(2026, 11, 20, 22) };
    const [moved] = all(buildAgenda({ events: [s], counts: {}, exceptions: [move], now: NOW }));
    expect(moved.originalStart.getTime()).toBe(new Date(local(2026, 11, 19, 19)).getTime());
    expect(dateActionsFor(moved, NOW)).toEqual(['restore']);
    // Once the original time has passed the server refuses a restore; so does the row.
    expect(dateActionsFor(moved, new Date(2026, 10, 19, 19, 30))).toEqual([]);
  });

  it('nothing for one-offs or a date already happening', () => {
    const [oneOff] = all(buildAgenda({ events: [event({ start: local(2026, 11, 18, 10) })], counts: {}, exceptions: [], now: NOW }));
    expect(dateActionsFor(oneOff, NOW)).toEqual([]);
    const daily = series({ frequency: 'daily', interval: 1 }, local(2026, 1, 1, 11), { end_datetime: local(2026, 1, 1, 13) });
    const [live] = all(buildAgenda({ events: [daily], counts: {}, exceptions: [], now: NOW }));
    expect(live.status).toBe('live');
    expect(dateActionsFor(live, NOW)).toEqual([]);
  });

  it('a one-off keeps originalStart equal to its start', () => {
    const [entry] = all(buildAgenda({ events: [event({ start: local(2026, 11, 18, 10) })], counts: {}, exceptions: [], now: NOW }));
    expect(entry.originalStart.getTime()).toBe(entry.start.getTime());
  });
});
