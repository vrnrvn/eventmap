import { describe, expect, it } from 'vitest';
import {
  DAY_OF_HOURS,
  announcementItemForStage,
  EXPERIENCED_HOST_EVENTS,
  MIN_DESCRIPTION_LENGTH,
  buildEventPlaybook,
  hoursUntilStart,
  omitPlaybookItems,
  playbookPillLabel,
  playbookFactsFromHub,
  playbookStage,
  playbookVisibility,
  resolvePlaybookState,
  type PlaybookEvent,
  type PlaybookItemId,
} from '@/utils/eventPlaybook';

const NOW = new Date('2026-11-13T12:00:00Z');
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

/** A complete, published event starting in a week. */
const base: PlaybookEvent = {
  title: 'Thursday run club',
  description: 'x'.repeat(MIN_DESCRIPTION_LENGTH),
  category_id: 'cat-1',
  cover_image_url: 'https://example.test/cover.jpg',
  address: '1 Main St',
  lat: 37.77,
  lng: -122.41,
  timezone: 'America/Los_Angeles',
  start_datetime: hoursFromNow(24 * 7),
  end_datetime: hoursFromNow(24 * 7 + 2),
  publish_state: 'published',
  status: 'active',
};

const build = (event: Partial<PlaybookEvent>, rest: Parameters<typeof buildEventPlaybook>[0] | object = {}) =>
  buildEventPlaybook({ event: { ...base, ...event }, now: NOW, ...(rest as object) });

const ids = (p: ReturnType<typeof buildEventPlaybook>) => p.items.map((i) => i.id);

describe('playbookStage', () => {
  it('maps each lifecycle phase to a list', () => {
    expect(playbookStage({ ...base, publish_state: 'draft' }, NOW)).toBe('before');
    expect(playbookStage(base, NOW)).toBe('leadup');
    expect(playbookStage({ ...base, status: 'postponed' }, NOW)).toBe('leadup');
    expect(playbookStage({ ...base, status: 'cancelled' }, NOW)).toBe('none');
    expect(
      playbookStage({ ...base, start_datetime: hoursFromNow(-1), end_datetime: hoursFromNow(1) }, NOW)
    ).toBe('dayof');
    expect(
      playbookStage({ ...base, start_datetime: hoursFromNow(-3), end_datetime: hoursFromNow(-1) }, NOW)
    ).toBe('after');
  });

  it('switches to the day-of list inside the final day', () => {
    const justOutside = hoursFromNow(DAY_OF_HOURS + 1);
    const justInside = hoursFromNow(DAY_OF_HOURS - 1);
    expect(playbookStage({ ...base, start_datetime: justOutside, end_datetime: hoursFromNow(50) }, NOW)).toBe('leadup');
    expect(playbookStage({ ...base, start_datetime: justInside, end_datetime: hoursFromNow(25) }, NOW)).toBe('dayof');
  });

  it('uses the next occurrence for a series, not the first date', () => {
    const series: PlaybookEvent = {
      ...base,
      is_recurring: true,
      start_datetime: hoursFromNow(-24 * 30),
      end_datetime: hoursFromNow(-24 * 30 + 2),
      next_start_datetime: hoursFromNow(6),
    };
    expect(hoursUntilStart(series, NOW)).toBeCloseTo(6);
    expect(playbookStage(series, NOW)).toBe('dayof');
  });
});

describe('buildEventPlaybook — before publishing', () => {
  const draft = { publish_state: 'draft' as const };

  it('a finished draft only has publish left', () => {
    const p = build(draft);
    expect(p.stage).toBe('before');
    expect(ids(p)).toEqual(['title', 'cover', 'description', 'place', 'when', 'capacity', 'links', 'publish']);
    expect(p.next?.id).toBe('capacity'); // no cap set and not ticked
    expect(p.items.find((i) => i.id === 'publish')?.done).toBe(false);
  });

  it('flags a thin draft item by item', () => {
    const p = build({ ...draft, title: 'Run', description: 'Short.', cover_image_url: null, address: '' });
    const done = Object.fromEntries(p.items.map((i) => [i.id, i.done]));
    expect(done.title).toBe(false);
    expect(done.description).toBe(false);
    expect(done.cover).toBe(false);
    expect(done.place).toBe(false);
    expect(p.next?.id).toBe('title');
    expect(p.complete).toBe(false);
  });

  it('counts an extra photo as a cover and a ticket_url as a link', () => {
    const p = build({ ...draft, cover_image_url: null, ticket_url: 'https://tickets.test/x' }, { facts: { photos: 2 } });
    const done = Object.fromEntries(p.items.map((i) => [i.id, i.done]));
    expect(done.cover).toBe(true);
    expect(done.links).toBe(true);
  });

  it('refuses a date in the past or an end before the start', () => {
    const past = build({ ...draft, start_datetime: hoursFromNow(-5), end_datetime: hoursFromNow(-4) });
    // A past draft is still "before"; the date item is what is wrong.
    expect(past.items.find((i) => i.id === 'when')?.done).toBe(false);
    const inverted = build({ ...draft, start_datetime: hoursFromNow(10), end_datetime: hoursFromNow(9) });
    expect(inverted.items.find((i) => i.id === 'when')?.done).toBe(false);
  });

  it('capacity and links can be answered by ticking them', () => {
    const p = build(draft, { manual: ['capacity', 'links'] satisfies PlaybookItemId[] });
    const byId = Object.fromEntries(p.items.map((i) => [i.id, i]));
    expect(byId.capacity.done).toBe(true);
    expect(byId.capacity.manual).toBe(true);
    expect(byId.links.done).toBe(true);
    expect(byId.title.manual).toBe(false); // derived items are read-only
  });
});

describe('buildEventPlaybook — lead-up and day of', () => {
  it('a freshly published event asks for the share and the followers', () => {
    const p = build({});
    expect(p.stage).toBe('leadup');
    expect(ids(p)).toEqual(['share', 'notify_followers', 'venue_confirmed']);
    expect(p.doneCount).toBe(0);
  });

  it('local signals tick share and followers', () => {
    const p = build({}, { local: { shared: true, notifiedFollowers: true } });
    expect(p.items.filter((i) => i.done).map((i) => i.id)).toEqual(['share', 'notify_followers']);
  });

  it('approval mode adds the requests item and clears when none are pending', () => {
    const pending = build({ rsvp_mode: 'approval' }, { facts: { requested: 3 } });
    expect(pending.items.find((i) => i.id === 'review_requests')?.done).toBe(false);
    const clear = build({ rsvp_mode: 'approval' }, { facts: { requested: 0 } });
    expect(clear.items.find((i) => i.id === 'review_requests')?.done).toBe(true);
    const open = build({ rsvp_mode: 'open' }, { facts: { requested: 3 } });
    expect(ids(open)).not.toContain('review_requests');
  });

  it('waitlist mode only matters with a cap, and not for a casual meetup', () => {
    expect(ids(build({ max_attendees: 40, waitlist_mode: 'auto' }))).toContain('waitlist_mode');
    expect(ids(build({ max_attendees: null }))).not.toContain('waitlist_mode');
    expect(ids(build({ max_attendees: 40, waitlist_mode: 'auto', event_type: 'casual' }))).not.toContain('waitlist_mode');
  });

  it('suggests a reminder only inside the reminder window', () => {
    expect(ids(build({}))).not.toContain('reminder_announcement');
    const soon = build({ start_datetime: hoursFromNow(48), end_datetime: hoursFromNow(50) });
    expect(ids(soon)).toContain('reminder_announcement');
    const sent = build(
      { start_datetime: hoursFromNow(48), end_datetime: hoursFromNow(50) },
      { facts: { reminderAnnouncementSent: true } }
    );
    expect(sent.items.find((i) => i.id === 'reminder_announcement')?.done).toBe(true);
  });

  it('shows reports only while some are open', () => {
    expect(ids(build({}, { facts: { openReports: 0 } }))).not.toContain('clear_reports');
    const p = build({}, { facts: { openReports: 2 } });
    expect(p.items.find((i) => i.id === 'clear_reports')).toMatchObject({ done: false, target: 'chat' });
  });

  it('the day-of list swaps followers for the pinned details', () => {
    const p = build({ start_datetime: hoursFromNow(3), end_datetime: hoursFromNow(5) });
    expect(p.stage).toBe('dayof');
    expect(ids(p)).toEqual(['share', 'reminder_announcement', 'pin_details', 'venue_confirmed']);
  });
});

describe('buildEventPlaybook — after', () => {
  const ended = { start_datetime: hoursFromNow(-5), end_datetime: hoursFromNow(-3) };

  it('an ended event gets the follow-up list', () => {
    const p = build(ended, { hostType: 'individual' });
    expect(p.stage).toBe('after');
    expect(ids(p)).toEqual(['thank_you', 'review_insights', 'run_again', 'lessons']);
  });

  it('only venues and organisers are asked about reviews', () => {
    expect(ids(build(ended, { hostType: 'venue', facts: { unansweredReviews: 2 } }))).toContain('reply_reviews');
    expect(ids(build(ended, { hostType: 'individual', facts: { unansweredReviews: 2 } }))).not.toContain('reply_reviews');
  });

  it('server evidence beats the local signal for run_again', () => {
    const p = build(ended, { facts: { ranAgain: true }, local: { duplicated: false } });
    expect(p.items.find((i) => i.id === 'run_again')?.done).toBe(true);
  });

  it('completes once every item is done', () => {
    const p = build(ended, {
      hostType: 'individual',
      facts: { thankYouSent: true, ranAgain: true },
      local: { openedInsights: true },
      manual: ['lessons'],
    });
    expect(p.complete).toBe(true);
    expect(p.next).toBeNull();
    expect(playbookPillLabel(p)).toBeNull();
  });
});

describe('unknown facts', () => {
  it('hide their item instead of showing it as not done', () => {
    // No facts at all: only items the app can see on its own survive.
    const p = build({ rsvp_mode: 'approval', max_attendees: 10 });
    expect(ids(p)).not.toContain('review_requests'); // requested unknown
    expect(ids(p)).not.toContain('waitlist_mode'); // waitlist_mode unknown
  });

  it('never hide an item the host can tick', () => {
    const p = build({ start_datetime: hoursFromNow(-5), end_datetime: hoursFromNow(-3) });
    // thankYouSent and lessons are unknown/manual, and still listed.
    expect(ids(p)).toContain('thank_you');
    expect(ids(p)).toContain('lessons');
  });

  it('a cancelled event has no playbook at all', () => {
    const p = build({ status: 'cancelled' });
    expect(p.stage).toBe('none');
    expect(p.items).toEqual([]);
    expect(p.complete).toBe(false);
    expect(playbookPillLabel(p)).toBeNull();
  });
});

describe('playbookVisibility', () => {
  const playbook = buildEventPlaybook({ event: base, now: NOW });

  it('expands for a new host and collapses for an experienced one', () => {
    expect(playbookVisibility({ playbook, dismissedStages: [], hostEventCount: 1 })).toBe('expanded');
    expect(
      playbookVisibility({ playbook, dismissedStages: [], hostEventCount: EXPERIENCED_HOST_EVENTS })
    ).toBe('collapsed');
    expect(playbookVisibility({ playbook, dismissedStages: [], hostEventCount: null })).toBe('collapsed');
  });

  it('dismissal is per stage', () => {
    expect(playbookVisibility({ playbook, dismissedStages: ['leadup'], hostEventCount: 1 })).toBe('hidden');
    expect(playbookVisibility({ playbook, dismissedStages: ['after'], hostEventCount: 1 })).toBe('expanded');
  });

  it('hides a complete or empty list', () => {
    const complete = buildEventPlaybook({ event: base, now: NOW, local: { shared: true, notifiedFollowers: true }, manual: ['venue_confirmed'] });
    expect(complete.complete).toBe(true);
    expect(playbookVisibility({ playbook: complete, dismissedStages: [], hostEventCount: 1 })).toBe('hidden');
    const cancelled = buildEventPlaybook({ event: { ...base, status: 'cancelled' }, now: NOW });
    expect(playbookVisibility({ playbook: cancelled, dismissedStages: [], hostEventCount: 1 })).toBe('hidden');
  });
});

describe('playbookPillLabel', () => {
  it('counts what is left', () => {
    expect(playbookPillLabel(buildEventPlaybook({ event: base, now: NOW }))).toBe('3 to do');
    expect(
      playbookPillLabel(buildEventPlaybook({ event: base, now: NOW, local: { shared: true } }))
    ).toBe('2 to do');
  });
});

describe('playbookFactsFromHub', () => {
  it('passes counts through and leaves missing ones unknown', () => {
    const f = playbookFactsFromHub({ event: base, now: NOW, requested: 2, links: 1 });
    expect(f).toMatchObject({ requested: 2, eventLinks: 1, openReports: null, photos: null, pinnedMessage: null });
    expect(f.reminderAnnouncementSent).toBeUndefined();
    expect(f.thankYouSent).toBeUndefined();
  });

  it('reads the pinned message only once the chat status has loaded', () => {
    expect(playbookFactsFromHub({ event: base, now: NOW, pinnedMessageId: undefined }).pinnedMessage).toBeNull();
    expect(playbookFactsFromHub({ event: base, now: NOW, pinnedMessageId: null }).pinnedMessage).toBe(false);
    expect(playbookFactsFromHub({ event: base, now: NOW, pinnedMessageId: 'm1' }).pinnedMessage).toBe(true);
  });

  it("today's announcement counts as the reminder only on the day", () => {
    const soon = { ...base, start_datetime: hoursFromNow(5), end_datetime: hoursFromNow(7) };
    expect(playbookFactsFromHub({ event: soon, now: NOW, announcementsToday: 1 }).reminderAnnouncementSent).toBe(true);
    const far = { ...base, start_datetime: hoursFromNow(60), end_datetime: hoursFromNow(62) };
    expect(playbookFactsFromHub({ event: far, now: NOW, announcementsToday: 1 }).reminderAnnouncementSent).toBeUndefined();
    expect(playbookFactsFromHub({ event: soon, now: NOW, announcementsToday: 0 }).reminderAnnouncementSent).toBeUndefined();
  });

  it("today's announcement counts as the thank-you only just after the end", () => {
    const justEnded = { ...base, start_datetime: hoursFromNow(-4), end_datetime: hoursFromNow(-2) };
    expect(playbookFactsFromHub({ event: justEnded, now: NOW, announcementsToday: 1 }).thankYouSent).toBe(true);
    const lastWeek = { ...base, start_datetime: hoursFromNow(-24 * 7), end_datetime: hoursFromNow(-24 * 7 + 2) };
    expect(playbookFactsFromHub({ event: lastWeek, now: NOW, announcementsToday: 1 }).thankYouSent).toBeUndefined();
  });
});

describe('omitPlaybookItems', () => {
  const draft = buildEventPlaybook({ event: { ...base, publish_state: 'draft' }, now: NOW, manual: ['capacity', 'links'] });

  it('drops items and recomputes the counts', () => {
    const without = omitPlaybookItems(draft, ['publish']);
    expect(without.items.map((i) => i.id)).not.toContain('publish');
    expect(without.total).toBe(draft.total - 1);
    expect(without.doneCount).toBe(draft.doneCount);
    // Everything but publish was done, so dropping it completes the list.
    expect(draft.complete).toBe(false);
    expect(without.complete).toBe(true);
    expect(without.next).toBeNull();
  });

  it('returns the same object when nothing matches', () => {
    expect(omitPlaybookItems(draft, ['thank_you'])).toBe(draft);
  });
});

describe('announcementItemForStage', () => {
  it('maps the stage the host is in to the item their message satisfies', () => {
    expect(announcementItemForStage('leadup')).toBe('reminder_announcement');
    expect(announcementItemForStage('dayof')).toBe('reminder_announcement');
    expect(announcementItemForStage('after')).toBe('thank_you');
    expect(announcementItemForStage('before')).toBeNull();
    expect(announcementItemForStage('none')).toBeNull();
  });
});

describe('resolvePlaybookState', () => {
  const local = { ticked: ['venue_confirmed'], dismissedStages: ['leadup'] };
  const empty = { ticked: [], dismissedStages: [] };

  it('uses the device copy when the backend has no checklist table', () => {
    expect(resolvePlaybookState(local, null)).toEqual({ ...local, uploadFromLocal: false });
  });

  it('prefers the server once it has anything stored', () => {
    const server = { ticked: ['lessons'], dismissedStages: [] };
    expect(resolvePlaybookState(local, server)).toEqual({ ...server, uploadFromLocal: false });
  });

  it('hands local ticks over the first time the server is empty', () => {
    expect(resolvePlaybookState(local, empty)).toEqual({ ...local, uploadFromLocal: true });
  });

  it('does not upload when there is nothing to hand over', () => {
    expect(resolvePlaybookState(empty, empty)).toEqual({ ...empty, uploadFromLocal: false });
  });

  it('respects a server row that only records a dismissal', () => {
    const server = { ticked: [], dismissedStages: ['after'] };
    expect(resolvePlaybookState(local, server)).toEqual({ ...server, uploadFromLocal: false });
  });
});
