import { describe, expect, it } from 'vitest';
import {
  buildCompareRows,
  cellAccessibilityLabel,
  fromEventDetails,
  fromRankedEvent,
  joinActionFor,
  joinModeLabel,
  partitionRows,
  spotsLeft,
  type CompareInput,
  type CompareRow,
} from '@/utils/compare';
import type { EventDetails, RankedEvent } from '@/types/database';

const NOW = new Date('2026-11-15T12:00:00Z');

function event(overrides: Partial<CompareInput> = {}): CompareInput {
  return {
    id: 'a',
    title: 'Jazz Night',
    coverImageUrl: null,
    categoryLabel: 'Live Music',
    startIso: '2026-11-20T19:00:00Z',
    endIso: '2026-11-20T22:00:00Z',
    timezone: 'Europe/Berlin',
    lat: 52.52,
    lng: 13.405,
    address: 'Alexanderplatz 1',
    priceLabel: null,
    ticketUrl: null,
    maxAttendees: null,
    rsvpCount: 0,
    isRecurring: false,
    recurrence: null,
    hostName: 'Blue Note',
    hostVerified: false,
    ageRestriction: null,
    accessibilityNotes: null,
    whatToBring: null,
    rsvpMode: null,
    rsvpClosed: false,
    waitlistMode: null,
    status: 'active',
    ...overrides,
  };
}

const rowFor = (rows: CompareRow[], key: string) => rows.find((r) => r.key === key)!;
const texts = (row: CompareRow) => row.cells.map((c) => c.text);

describe('spotsLeft', () => {
  it('is null for an uncapped event and never negative', () => {
    expect(spotsLeft({ maxAttendees: null, rsvpCount: 9 })).toBeNull();
    expect(spotsLeft({ maxAttendees: 10, rsvpCount: 4 })).toBe(6);
    expect(spotsLeft({ maxAttendees: 10, rsvpCount: 12 })).toBe(0);
  });
});

describe('joinModeLabel', () => {
  it('reports the state that actually blocks joining, in priority order', () => {
    expect(joinModeLabel(event({ status: 'cancelled', rsvpClosed: true }))).toBe('Cancelled');
    expect(joinModeLabel(event({ status: 'postponed' }))).toBe('Postponed');
    expect(joinModeLabel(event({ rsvpClosed: true }))).toBe('RSVPs closed');
    expect(joinModeLabel(event({ maxAttendees: 5, rsvpCount: 5 }))).toBe('Full');
    expect(joinModeLabel(event({ maxAttendees: 5, rsvpCount: 5, waitlistMode: 'notify' }))).toBe('Full · waitlist');
    expect(joinModeLabel(event({ rsvpMode: 'approval' }))).toBe('Host approves');
    expect(joinModeLabel(event())).toBe('Open to all');
  });
});

describe('joinActionFor', () => {
  it('joins in one tap only when nothing stands in the way', () => {
    expect(joinActionFor(event(), true)).toEqual({ kind: 'join', label: 'Join' });
  });

  it('hands every second-step state to the event page', () => {
    expect(joinActionFor(event({ rsvpMode: 'approval' }), true)).toEqual({ kind: 'open', label: 'Request to join' });
    expect(joinActionFor(event({ maxAttendees: 2, rsvpCount: 2, waitlistMode: 'notify' }), true)).toEqual({
      kind: 'open',
      label: 'Join waitlist',
    });
    expect(joinActionFor(event({ maxAttendees: 2, rsvpCount: 2 }), true)).toEqual({ kind: 'open', label: 'Full' });
    expect(joinActionFor(event({ rsvpClosed: true }), true)).toEqual({ kind: 'open', label: 'RSVPs closed' });
    expect(joinActionFor(event({ status: 'cancelled' }), true)).toEqual({ kind: 'open', label: 'Cancelled' });
  });

  it('asks a signed-out viewer to sign in, but still names a blocked state', () => {
    expect(joinActionFor(event(), false)).toEqual({ kind: 'open', label: 'Sign in to join' });
    expect(joinActionFor(event({ status: 'cancelled' }), false)).toEqual({ kind: 'open', label: 'Cancelled' });
  });

  it('reflects the viewer\'s own RSVP first', () => {
    expect(joinActionFor(event({ userRsvp: 'going' }), true)).toEqual({ kind: 'going', label: "You're going" });
    expect(joinActionFor(event({ userRsvp: 'requested' }), true)).toEqual({ kind: 'open', label: 'Request pending' });
  });
});

describe('buildCompareRows', () => {
  it('returns nothing for an empty selection', () => {
    expect(buildCompareRows([], { now: NOW })).toEqual([]);
  });

  it('marks the soonest event', () => {
    const rows = buildCompareRows(
      [
        event({ id: 'a', startIso: '2026-11-21T19:00:00Z' }),
        event({ id: 'b', startIso: '2026-11-20T19:00:00Z' }),
        event({ id: 'c', startIso: '2026-11-22T19:00:00Z' }),
      ],
      { now: NOW }
    );
    const when = rowFor(rows, 'when');
    expect(when.best).toBe(1);
    expect(when.bestLabel).toBe('Soonest');
  });

  it('marks nothing when the best value is shared', () => {
    const rows = buildCompareRows(
      [
        event({ id: 'a', startIso: '2026-11-20T19:00:00Z' }),
        event({ id: 'b', startIso: '2026-11-20T19:00:00Z' }),
        event({ id: 'c', startIso: '2026-11-22T19:00:00Z' }),
      ],
      { now: NOW }
    );
    expect(rowFor(rows, 'when').best).toBeNull();
  });

  it('rebuilds distance from one reference point', () => {
    const rows = buildCompareRows(
      [
        // ~0 km and ~110 km north of the reference.
        event({ id: 'a', lat: 52.52, lng: 13.405 }),
        event({ id: 'b', lat: 53.52, lng: 13.405 }),
      ],
      { now: NOW, reference: { lat: 52.52, lng: 13.405 }, locale: 'de-DE' }
    );
    const distance = rowFor(rows, 'distance');
    expect(distance.best).toBe(0);
    expect(distance.bestLabel).toBe('Nearest');
    expect(distance.cells[1].text).toMatch(/111 km/);
  });

  it('omits the distance row entirely when there is no reference', () => {
    const rows = buildCompareRows([event({ id: 'a' }), event({ id: 'b' })], { now: NOW });
    expect(rows.find((r) => r.key === 'distance')).toBeUndefined();
  });

  it('shows the host wording for price and marks the cheapest', () => {
    const rows = buildCompareRows(
      [
        event({ id: 'a', priceLabel: '€12 at the door' }),
        event({ id: 'b', priceLabel: 'Free' }),
        event({ id: 'c', priceLabel: 'From €20' }),
      ],
      { now: NOW }
    );
    const price = rowFor(rows, 'price');
    expect(texts(price)).toEqual(['€12 at the door', 'Free', 'From €20']);
    expect(price.best).toBe(1);
    expect(price.bestLabel).toBe('Cheapest');
  });

  it('refuses to mark a cheapest across mixed currencies', () => {
    const rows = buildCompareRows(
      [event({ id: 'a', priceLabel: '€10' }), event({ id: 'b', priceLabel: '$5' })],
      { now: NOW }
    );
    expect(rowFor(rows, 'price').best).toBeNull();
  });

  it('refuses to mark a cheapest when one label cannot be read', () => {
    const rows = buildCompareRows(
      [event({ id: 'a', priceLabel: '€10' }), event({ id: 'b', priceLabel: 'Donation' })],
      { now: NOW }
    );
    expect(rowFor(rows, 'price').best).toBeNull();
  });

  it('treats unlimited capacity as the most room', () => {
    const rows = buildCompareRows(
      [
        event({ id: 'a', maxAttendees: 10, rsvpCount: 8 }),
        event({ id: 'b', maxAttendees: null, rsvpCount: 200 }),
        event({ id: 'c', maxAttendees: 10, rsvpCount: 10 }),
      ],
      { now: NOW }
    );
    const spots = rowFor(rows, 'spots');
    expect(texts(spots)).toEqual(['2', 'Unlimited', 'Full']);
    expect(spots.best).toBe(1);
    expect(spots.bestLabel).toBe('Most room');
  });

  it('flags rows where every event says the same thing', () => {
    const rows = buildCompareRows(
      [event({ id: 'a', categoryLabel: 'Live Music' }), event({ id: 'b', categoryLabel: 'Live Music' })],
      { now: NOW }
    );
    expect(rowFor(rows, 'type').identical).toBe(true);
    expect(rowFor(rows, 'when').identical).toBe(true);
    const split = partitionRows(rows);
    expect(split.identical.map((r) => r.key)).toContain('type');
    expect(split.differing.map((r) => r.key)).not.toContain('type');
  });

  it('drops an attribute nobody filled in, and keeps one somebody did', () => {
    const rows = buildCompareRows(
      [event({ id: 'a' }), event({ id: 'b', whatToBring: 'A yoga mat' })],
      { now: NOW }
    );
    expect(rows.find((r) => r.key === 'age')).toBeUndefined();
    expect(rows.find((r) => r.key === 'accessibility')).toBeUndefined();
    expect(texts(rowFor(rows, 'bring'))).toEqual(['', 'A yoga mat']);
  });

  it('carries the cadence of a series next to its next date', () => {
    const rows = buildCompareRows(
      [
        event({ id: 'a', isRecurring: true, recurrence: { frequency: 'weekly', interval: 1 } }),
        event({ id: 'b' }),
      ],
      { now: NOW }
    );
    expect(rowFor(rows, 'when').cells[0].detail).toBe('Weekly');
    expect(texts(rowFor(rows, 'repeats'))).toEqual(['Weekly', 'One-off']);
  });
});

describe('cellAccessibilityLabel', () => {
  it('names the row, the event, the value and the mark', () => {
    const rows = buildCompareRows(
      [event({ id: 'a', priceLabel: 'Free' }), event({ id: 'b', priceLabel: '€12' })],
      { now: NOW }
    );
    const price = rowFor(rows, 'price');
    expect(cellAccessibilityLabel(price, 0, 'Jazz Night')).toBe('Price, Jazz Night: Free. Cheapest');
    expect(cellAccessibilityLabel(price, 1, 'Open Mic')).toBe('Price, Open Mic: €12');
  });

  it('says "Not stated" rather than leaving a cell silent', () => {
    const rows = buildCompareRows(
      [event({ id: 'a' }), event({ id: 'b', whatToBring: 'Cash' })],
      { now: NOW }
    );
    expect(cellAccessibilityLabel(rowFor(rows, 'bring'), 0, 'Jazz Night')).toBe(
      'What to bring, Jazz Night: Not stated'
    );
  });
});

describe('adapters', () => {
  it('prefers the effective next date over the series start', () => {
    const ranked = {
      id: 'a',
      title: 'Jazz Night',
      cover_image_url: null,
      category_label: 'Live Music',
      start_datetime: '2026-11-01T19:00:00Z',
      next_start_datetime: '2026-11-22T19:00:00Z',
      end_datetime: '2026-11-01T22:00:00Z',
      lat: 52.52,
      lng: 13.405,
      address: 'Alexanderplatz 1',
      business_name: 'Blue Note',
      rsvp_count: 3,
      is_recurring: true,
      recurrence_pattern: { frequency: 'weekly', interval: 1 },
    } as unknown as RankedEvent;

    expect(fromRankedEvent(ranked).startIso).toBe('2026-11-22T19:00:00Z');
    expect(fromRankedEvent(ranked).userSaved).toBe(false);
    // An explicit occurrence (useEffectiveNextDates) wins over both.
    expect(fromRankedEvent(ranked, '2026-11-29T19:00:00Z').startIso).toBe('2026-11-29T19:00:00Z');
  });

  it('reads the host and category out of a details payload', () => {
    const details = {
      event: {
        id: 'a',
        title: 'Jazz Night',
        cover_image_url: null,
        start_datetime: '2026-11-20T19:00:00Z',
        end_datetime: '2026-11-20T22:00:00Z',
        lat: 52.52,
        lng: 13.405,
        address: 'Alexanderplatz 1',
        price_label: '€12',
        max_attendees: 40,
        age_restriction: '18+',
      },
      business: { name: 'Blue Note', verified: true },
      category: { label: 'Live Music' },
      rsvp_count: 7,
    } as unknown as EventDetails;

    const input = fromEventDetails(details);
    expect(input).toMatchObject({
      hostName: 'Blue Note',
      hostVerified: true,
      categoryLabel: 'Live Music',
      priceLabel: '€12',
      rsvpCount: 7,
      ageRestriction: '18+',
    });
    expect(spotsLeft(input)).toBe(33);
  });
});
