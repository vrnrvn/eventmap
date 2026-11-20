import { describe, expect, it } from 'vitest';
import {
  PLAN_B,
  candidateSession,
  planBAnchor,
  planBChips,
  planBSectionCopy,
  rankPlanB,
  type PlanBAnchor,
} from '@/utils/planB';
import type { OccurrenceException } from '@/utils/occurrences';
import type { RankedEvent } from '@/types/database';

const H = 60 * 60 * 1000;
const M = 60 * 1000;
const NOW = new Date('2026-12-05T15:00:00.000Z');
const at = (h: number) => new Date(NOW.getTime() + h * H);
const iso = (h: number) => at(h).toISOString();

const MUSIC = 'cat-music';
const FOOD = 'cat-food';

const original = { id: 'orig', business_id: 'biz-orig', category_id: MUSIC, lat: 40.7, lng: -74 };

/** The cancelled 20:00–23:00 gig: window 18:00 → 00:00. */
function cancelledAnchor(): PlanBAnchor {
  return planBAnchor({
    reason: 'cancelled',
    event: original,
    categoryLabel: 'Live music',
    session: { start: at(5), end: at(8) },
    now: NOW,
  })!;
}

let seq = 0;
function row(over: Partial<RankedEvent> & { startH?: number; endH?: number } = {}): RankedEvent {
  seq += 1;
  const { startH = 5, endH = 7, ...rest } = over;
  return {
    id: `ev-${String(seq).padStart(3, '0')}`,
    business_id: 'biz-other',
    title: `Event ${seq}`,
    description: '',
    category_id: FOOD,
    start_datetime: iso(startH),
    end_datetime: iso(endH),
    lat: 40.7,
    lng: -74,
    address: '',
    cover_image_url: null,
    is_recurring: false,
    recurrence_pattern: null,
    max_attendees: null,
    created_at: iso(-100),
    distance_km: 1,
    is_premium: false,
    rsvp_count: 0,
    save_count: 0,
    business_name: 'Somewhere',
    business_logo_url: null,
    category_label: 'Food',
    category_slug: 'food',
    user_rsvp: null,
    user_saved: false,
    ...rest,
  } as RankedEvent;
}

describe('planBAnchor', () => {
  it('cancelled one-off: searches from the venue, 2 h before the start to 1 h after the end', () => {
    const a = cancelledAnchor();
    expect(a.lat).toBe(40.7);
    expect(a.windowStart.toISOString()).toBe(iso(3));
    expect(a.windowEnd.toISOString()).toBe(iso(9));
    expect(a.inProgressAt.toISOString()).toBe(iso(5));
    expect(a.minLeftMs).toBe(45 * M);
  });

  it('is null once the evening it was for is over', () => {
    expect(
      planBAnchor({ reason: 'cancelled', event: original, session: { start: at(-6), end: at(-3) }, now: NOW })
    ).toBeNull();
    // Just inside: the window runs to end + 1 h.
    expect(
      planBAnchor({ reason: 'cancelled', event: original, session: { start: at(-4), end: at(-0.5) }, now: NOW })
    ).not.toBeNull();
  });

  it('late: from now, at the viewer when known, else the venue', () => {
    const a = planBAnchor({
      reason: 'late',
      event: original,
      session: { start: at(0.25), end: at(3) },
      now: NOW,
      viewer: { lat: 41, lng: -73.9 },
    })!;
    expect([a.lat, a.lng]).toEqual([41, -73.9]);
    expect(a.windowStart.toISOString()).toBe(NOW.toISOString());
    expect(a.windowEnd.toISOString()).toBe(iso(1));
    const v = planBAnchor({ reason: 'late', event: original, session: { start: at(0.25), end: at(3) }, now: NOW })!;
    expect([v.lat, v.lng]).toEqual([40.7, -74]);
  });

  it('keeps the cancelled date key (T2)', () => {
    const a = planBAnchor({
      reason: 'date_cancelled',
      event: original,
      session: { start: at(5), end: at(8), dateKey: '2026-12-05' },
      now: NOW,
    })!;
    expect(a.dateKey).toBe('2026-12-05');
  });
});

describe('rankPlanB — hard filters (§2.2)', () => {
  const rank = (rows: RankedEvent[], opts: Partial<Parameters<typeof rankPlanB>[2]> = {}) =>
    rankPlanB(cancelledAnchor(), rows, { now: NOW, limit: 10, ...opts });

  it('never suggests the event that fell through', () => {
    expect(rank([row({ id: 'orig' })])).toEqual([]);
  });

  it('drops what the viewer is already going to or waiting on; keeps "interested"', () => {
    const going = row({ user_rsvp: 'going' });
    const requested = row({ user_rsvp: 'requested' });
    const interested = row({ user_rsvp: 'interested' });
    expect(rank([going, requested, interested]).map((p) => p.event.id)).toEqual([interested.id]);
  });

  it('drops full events; keeps uncapped and those with room', () => {
    const full = row({ max_attendees: 10, rsvp_count: 10 });
    const room = row({ max_attendees: 10, rsvp_count: 7 });
    const open = row({ max_attendees: null });
    const ids = rank([full, room, open]).map((p) => p.event.id);
    expect(ids).toContain(room.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(full.id);
  });

  it('drops a row that says it is not active (ranked rows carry no status: kept)', () => {
    const cancelled = row({ status: 'cancelled' });
    const postponed = row({ status: 'postponed' });
    const noStatus = row();
    expect(rank([cancelled, postponed, noStatus]).map((p) => p.event.id)).toEqual([noStatus.id]);
  });

  it('drops anything past the radius', () => {
    const far = row({ distance_km: 10.5 });
    const edge = row({ distance_km: 10 });
    expect(rank([far, edge]).map((p) => p.event.id)).toEqual([edge.id]);
    expect(rank([far], { radiusKm: 25 }).map((p) => p.event.id)).toEqual([far.id]);
  });

  it('window: starts between start − 2 h and end + 1 h', () => {
    const tooEarly = row({ startH: 2.9, endH: 3.5 }); // 17:54, over by the anchor
    const first = row({ startH: 3, endH: 4 }); // 18:00
    const last = row({ startH: 9, endH: 10 }); // 00:00
    const tooLate = row({ startH: 9.1, endH: 10 });
    expect(rank([tooEarly, first, last, tooLate]).map((p) => p.event.id).sort()).toEqual([first.id, last.id].sort());
  });

  it('already running at the anchor start: needs ≥ 45 min left', () => {
    const plenty = row({ startH: 1, endH: 6 }); // 16:00–21:00, 60 min left at 20:00
    const short = row({ startH: 1, endH: 5.5 }); // 30 min left at 20:00
    expect(rank([plenty, short]).map((p) => p.event.id)).toEqual([plenty.id]);
  });

  it('never suggests something already over', () => {
    const anchor = planBAnchor({ reason: 'cancelled', event: original, session: { start: at(-1), end: at(2) }, now: NOW })!;
    const over = row({ startH: -2.5, endH: -0.1 });
    const running = row({ startH: -2.5, endH: 2 });
    expect(rankPlanB(anchor, [over, running], { now: NOW }).map((p) => p.event.id)).toEqual([running.id]);
  });
});

describe('candidateSession — series', () => {
  // Weekly on the anchor's weekday at 20:00 UTC (the same slot as the gig).
  const series = () =>
    row({
      id: 'series-1',
      is_recurring: true,
      recurrence_pattern: { frequency: 'weekly', interval: 1 } as never,
      start_datetime: '2026-11-07T20:00:00.000Z',
      end_datetime: '2026-11-07T22:00:00.000Z',
    });

  it("finds tonight's session of a weekly series", () => {
    const s = candidateSession(series(), cancelledAnchor(), [], NOW);
    expect(s?.start.toISOString()).toBe('2026-12-05T20:00:00.000Z');
  });

  it('a skipped date is never suggested', () => {
    const skip: OccurrenceException = {
      event_id: 'series-1',
      occurrence_date: '2026-12-05',
      kind: 'cancelled',
      new_start: null,
      new_end: null,
      note: null,
    };
    expect(candidateSession(series(), cancelledAnchor(), [skip], NOW)).toBeNull();
  });

  it("a date moved into the window is suggested at its new time; another event's exception is ignored", () => {
    const moved: OccurrenceException = {
      event_id: 'series-1',
      occurrence_date: '2026-12-05',
      kind: 'rescheduled',
      new_start: '2026-12-05T21:30:00.000Z',
      new_end: '2026-12-05T23:00:00.000Z',
      note: null,
    };
    const other: OccurrenceException = { ...moved, event_id: 'someone-else', kind: 'cancelled', new_start: null, new_end: null };
    const s = candidateSession(series(), cancelledAnchor(), [moved, other], NOW);
    expect(s?.start.toISOString()).toBe('2026-12-05T21:30:00.000Z');
  });

  it('uses the live page session when the row carries one', () => {
    const live = { ...row({ startH: -10, endH: -9 }), occ_start: iso(4), occ_end: iso(6) };
    expect(candidateSession(live, cancelledAnchor(), [], NOW)?.start.toISOString()).toBe(iso(4));
  });
});

describe('rankPlanB — score and order (§2.3)', () => {
  it('same category beats a closer, better-timed different one', () => {
    const music = row({ category_id: MUSIC, distance_km: 6, startH: 6.5, endH: 8 });
    const food = row({ category_id: FOOD, distance_km: 0.2, startH: 5, endH: 7 });
    expect(rankPlanB(cancelledAnchor(), [food, music], { now: NOW }).map((p) => p.event.id)).toEqual([music.id, food.id]);
  });

  it('interests boost but never filter', () => {
    const plain = row({ category_id: 'cat-x', distance_km: 1 });
    const liked = row({ category_id: 'cat-y', distance_km: 1 });
    const out = rankPlanB(cancelledAnchor(), [plain, liked], { now: NOW, preferredCategoryIds: ['cat-y'] });
    expect(out.map((p) => p.event.id)).toEqual([liked.id, plain.id]);
  });

  it('closer in time and place scores higher', () => {
    const near = row({ distance_km: 0.5, startH: 5, endH: 7 });
    const far = row({ distance_km: 8, startH: 8.5, endH: 10 });
    expect(rankPlanB(cancelledAnchor(), [far, near], { now: NOW }).map((p) => p.event.id)).toEqual([near.id, far.id]);
  });

  it('ties break on the earlier start, then the id: deterministic', () => {
    const b = row({ id: 'b', startH: 5, endH: 7 });
    const a = row({ id: 'a', startH: 5, endH: 7 });
    const earlier = row({ id: 'z', startH: 4.9, endH: 7 });
    const out = rankPlanB(cancelledAnchor(), [b, a, earlier], { now: NOW }).map((p) => p.event.id);
    // 'z' starts 6 min earlier: same time-fit bucket (±30 min), so start decides.
    expect(out).toEqual(['z', 'a', 'b']);
    expect(rankPlanB(cancelledAnchor(), [a, earlier, b], { now: NOW }).map((p) => p.event.id)).toEqual(out);
  });

  it('returns at most `limit` (default 3)', () => {
    const rows = Array.from({ length: 6 }, () => row());
    expect(rankPlanB(cancelledAnchor(), rows, { now: NOW })).toHaveLength(PLAN_B.limit);
  });
});

describe('late (T5)', () => {
  const anchor = () =>
    planBAnchor({ reason: 'late', event: original, session: { start: at(0.25), end: at(3) }, now: NOW })!;

  it('live with ≥ 30 min left, or starting within the hour', () => {
    const liveLong = row({ startH: -1, endH: 1 }); // 60 min left
    const liveShort = row({ startH: -1, endH: 0.4 }); // 24 min left
    const soon = row({ startH: 0.9, endH: 2 }); // in 54 min
    const later = row({ startH: 1.5, endH: 3 });
    expect(rankPlanB(anchor(), [liveLong, liveShort, soon, later], { now: NOW, limit: 10 }).map((p) => p.event.id).sort())
      .toEqual([liveLong.id, soon.id].sort());
  });

  it('chips say how soon', () => {
    const liveNow = row({ startH: -1, endH: 1, category_id: MUSIC });
    const [pick] = rankPlanB(anchor(), [liveNow], { now: NOW });
    expect(planBChips(pick, { ...anchor(), categoryLabel: 'Live music' }, NOW)).toContain('Happening now');
  });
});

describe('reasons and copy (§2.4)', () => {
  it('names the signals that fired, most telling first, at most three', () => {
    const r = row({
      category_id: MUSIC,
      business_id: 'biz-orig',
      distance_km: 0.6,
      startH: 5.25,
      endH: 7,
      max_attendees: 20,
      rsvp_count: 12,
    });
    const anchor = cancelledAnchor();
    const [pick] = rankPlanB(anchor, [r], { now: NOW });
    expect(pick.reasons).toEqual(['same_category', 'time_close', 'near_anchor', 'same_host', 'has_room']);
    const chips = planBChips(pick, anchor, NOW);
    expect(chips.slice(0, 2)).toEqual(['Also live music', 'Starts 15 min later']);
    // Units follow the device locale (km / mi).
    expect(chips[2]).toMatch(/^0\.\d+ (km|mi) from the original$/);
    expect(chips).toHaveLength(3);
  });

  it('time wording: same time / earlier / already on', () => {
    const anchor = cancelledAnchor();
    const same = rankPlanB(anchor, [row({ startH: 5.05, endH: 7 })], { now: NOW })[0];
    const earlier = rankPlanB(anchor, [row({ startH: 4.75, endH: 7 })], { now: NOW })[0];
    const already = rankPlanB(anchor, [row({ startH: 1, endH: 7 })], { now: NOW })[0];
    expect(planBChips(same, anchor, NOW)).toContain('Same time');
    expect(planBChips(earlier, anchor, NOW)).toContain('Starts 15 min earlier');
    expect(planBChips(already, anchor, NOW)).toContain('Already on by then');
  });

  it('spots left only when few', () => {
    const anchor = cancelledAnchor();
    const one = rankPlanB(anchor, [row({ max_attendees: 5, rsvp_count: 4, distance_km: 5 })], { now: NOW })[0];
    const many = rankPlanB(anchor, [row({ max_attendees: 100, rsvp_count: 4, distance_km: 5 })], { now: NOW })[0];
    expect(one.reasons).toContain('has_room');
    expect(planBChips(one, anchor, NOW)).toContain('1 spot left');
    expect(many.reasons).not.toContain('has_room');
  });

  it('section copy per moment', () => {
    expect(planBSectionCopy(cancelledAnchor()).title).toBe('Still want to go out?');
    expect(planBSectionCopy({ ...cancelledAnchor(), reason: 'full' }).title).toBe("Full — here's what else is on then");
    expect(planBSectionCopy({ ...cancelledAnchor(), reason: 'date_cancelled' }, 'Sat, Dec 5').title).toBe(
      "Sat, Dec 5 is cancelled — here's what else is on"
    );
  });
});
