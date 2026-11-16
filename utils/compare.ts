/**
 * The comparison row model (docs/EVENT_COMPARISON_PLAN.md §3.2).
 *
 * Everything the compare screen needs to decide *what* to draw is computed
 * here: which rows exist, what each cell says, which rows are identical across
 * every event (so they can collapse), and which cell holds the objectively
 * better value (so it can be marked). The screen itself only lays the result
 * out — table or cards, the rows are the same.
 *
 * Two rules the plan fixes and this module enforces:
 *  - **A tie marks nothing.** "Two cheapest" is not a useful answer, and a
 *    mark that appears twice reads as a bug.
 *  - **Only objective attributes are ranked.** Soonest, nearest, cheapest and
 *    most room. There is no overall score and no recommendation.
 *
 * Pure module (no React Native imports) so it is unit-tested under node.
 */

import type {
  AgeRestriction,
  AttendeeRsvpStatus,
  EventDetails,
  EventStatus,
  EventVisibility,
  RankedEvent,
  RecurrencePattern,
  RsvpMode,
  WaitlistMode,
} from '@/types/database';
import { haversineKm, type LatLng } from '@/utils/geoBounds';
import { formatDistance, formatEventDate } from '@/utils/formatEventWhen';
import { cadenceLabel } from '@/utils/recurrence';
import { arePricesComparable, parsePriceLabel, priceRank } from '@/utils/comparePrice';

/** The flattened event as the tray stores it and the rows are built from. */
export type CompareInput = {
  id: string;
  title: string;
  coverImageUrl: string | null;
  categoryLabel: string;
  /**
   * The occurrence being compared — for a series this is the *effective* next
   * date (`useEffectiveNextDates`), not `start_datetime` and not the server's
   * `next_start`, which still ignores per-date exceptions (ISSUES, E-R1).
   */
  startIso: string;
  endIso: string | null;
  timezone: string | null;
  lat: number;
  lng: number;
  address: string;
  priceLabel: string | null;
  ticketUrl: string | null;
  maxAttendees: number | null;
  rsvpCount: number;
  isRecurring: boolean;
  recurrence: RecurrencePattern | null;
  hostName: string;
  hostVerified: boolean;
  ageRestriction: AgeRestriction | null;
  accessibilityNotes: string | null;
  whatToBring: string | null;
  rsvpMode: RsvpMode | null;
  rsvpClosed: boolean;
  waitlistMode: WaitlistMode | null;
  status: EventStatus | null;
  /** Viewer state, when the source row carries it (per-column actions). */
  userRsvp?: AttendeeRsvpStatus | null;
  userSaved?: boolean;
  /** 'unlisted' events stay out of shareable links (utils/compareLink). */
  visibility?: EventVisibility | null;
};

export type CompareRowKey =
  | 'when'
  | 'distance'
  | 'price'
  | 'spots'
  | 'type'
  | 'repeats'
  | 'host'
  | 'going'
  | 'join'
  | 'age'
  | 'accessibility'
  | 'bring'
  | 'tickets';

export type CompareCell = {
  /** Primary text. '' means "not stated" and renders as the placeholder. */
  text: string;
  /** Optional second line (cadence, "your time", capacity detail). */
  detail?: string;
};

export type CompareRow = {
  key: CompareRowKey;
  label: string;
  /** One cell per event, in the order the events were passed in. */
  cells: CompareCell[];
  /** Every cell says the same thing — the row can collapse. */
  identical: boolean;
  /** Index of the single best cell, or null when tied / not rankable. */
  best: number | null;
  /** Word for the mark and its spoken label ("Nearest"). */
  bestLabel: string | null;
};

export type BuildRowsOptions = {
  /**
   * The one point every distance is measured from. `RankedEvent.distance_km`
   * is relative to whatever centre that list was fetched with, so two events
   * picked from two surfaces carry non-comparable numbers; the distance row
   * is rebuilt from here or left out entirely (plan §3.4).
   */
  reference?: LatLng | null;
  now?: Date;
  locale?: string;
};

const NOT_STATED = '';

/** Spots left, or null for an uncapped event. */
export function spotsLeft(event: Pick<CompareInput, 'maxAttendees' | 'rsvpCount'>): number | null {
  if (event.maxAttendees == null) return null;
  return Math.max(0, event.maxAttendees - event.rsvpCount);
}

/** How a viewer would get in, in the words the event page uses. */
export function joinModeLabel(event: CompareInput): string {
  if (event.status === 'cancelled') return 'Cancelled';
  if (event.status === 'postponed') return 'Postponed';
  if (event.rsvpClosed) return 'RSVPs closed';
  const left = spotsLeft(event);
  if (left === 0) {
    return event.waitlistMode && event.waitlistMode !== 'off' ? 'Full · waitlist' : 'Full';
  }
  return event.rsvpMode === 'approval' ? 'Host approves' : 'Open to all';
}

export type CompareJoinAction =
  /** One tap joins: open RSVPs, room left, nothing blocking. */
  | { kind: 'join'; label: string }
  /** Already going — nothing to do here. */
  | { kind: 'going'; label: string }
  /** Anything with a second step (waitlist, approval, sign-in, blocked): the event page handles it. */
  | { kind: 'open'; label: string };

/**
 * What the per-column action does. Deliberately the *reduced* machine: only
 * the plain case joins from the comparison; every state with a second step
 * — waitlist position, approval, closed RSVPs, signing in — hands off to the
 * event page, so there is one place that owns those flows
 * (`screens/EventDetail.tsx`), not two that can drift.
 */
export function joinActionFor(event: CompareInput, signedIn: boolean): CompareJoinAction {
  if (event.userRsvp === 'going') return { kind: 'going', label: "You're going" };
  if (event.userRsvp === 'requested') return { kind: 'open', label: 'Request pending' };
  const mode = joinModeLabel(event);
  if (mode === 'Cancelled' || mode === 'Postponed' || mode === 'RSVPs closed' || mode === 'Full') {
    return { kind: 'open', label: mode };
  }
  if (!signedIn) return { kind: 'open', label: 'Sign in to join' };
  if (mode === 'Full · waitlist') return { kind: 'open', label: 'Join waitlist' };
  if (mode === 'Host approves') return { kind: 'open', label: 'Request to join' };
  return { kind: 'join', label: 'Join' };
}

/**
 * Picks the single best index by `rank` (lower wins) — or null when nothing is
 * rankable or the best value is shared. See the tie rule at the top.
 */
function bestOf(ranks: readonly (number | null)[]): number | null {
  // NaN means "unreadable"; ±Infinity is a real answer (an uncapped event has
  // the most room there is), so it must survive the filter.
  const scored = ranks
    .map((rank, index) => ({ rank, index }))
    .filter((r): r is { rank: number; index: number } => r.rank != null && !Number.isNaN(r.rank));
  if (scored.length < 2) return null;
  let bestRank = Infinity;
  for (const s of scored) bestRank = Math.min(bestRank, s.rank);
  const winners = scored.filter((s) => s.rank === bestRank);
  return winners.length === 1 ? winners[0].index : null;
}

function allSame(cells: readonly CompareCell[]): boolean {
  if (cells.length < 2) return false;
  const first = `${cells[0].text}\u0000${cells[0].detail ?? ''}`;
  return cells.every((c) => `${c.text}\u0000${c.detail ?? ''}` === first);
}

function row(
  key: CompareRowKey,
  label: string,
  cells: CompareCell[],
  rank?: { values: (number | null)[]; label: string }
): CompareRow {
  const best = rank ? bestOf(rank.values) : null;
  return {
    key,
    label,
    cells,
    identical: allSame(cells),
    best,
    bestLabel: best == null ? null : rank!.label,
  };
}

/**
 * Builds every row for a comparison. Rows whose cells are all empty are
 * dropped (nobody stated an age limit → no Age row), which is different from
 * a row whose cells all say the *same* thing (that one collapses and can be
 * expanded). The distance row is dropped when there is no reference point.
 */
export function buildCompareRows(
  events: readonly CompareInput[],
  options: BuildRowsOptions = {}
): CompareRow[] {
  const { reference = null, now = new Date(), locale } = options;
  if (events.length === 0) return [];

  const rows: CompareRow[] = [];

  // ── When ──
  rows.push(
    row(
      'when',
      'When',
      events.map((e) => ({
        text: formatEventDate(e.startIso, now),
        detail: e.isRecurring ? cadenceLabel(e.recurrence) || 'Repeats' : undefined,
      })),
      {
        values: events.map((e) => {
          const t = new Date(e.startIso).getTime();
          return Number.isNaN(t) ? null : t;
        }),
        label: 'Soonest',
      }
    )
  );

  // ── Distance (recomputed from one reference, or omitted) ──
  if (reference) {
    const km = events.map((e) => haversineKm(reference, { lat: e.lat, lng: e.lng }));
    rows.push(
      row(
        'distance',
        'Distance',
        km.map((d, i) => ({ text: formatDistance(d, locale), detail: events[i].address || undefined })),
        { values: km.map((d) => (Number.isFinite(d) ? d : null)), label: 'Nearest' }
      )
    );
  }

  // ── Price ──
  const parsed = events.map((e) => parsePriceLabel(e.priceLabel));
  const comparable = arePricesComparable(parsed);
  rows.push(
    row(
      'price',
      'Price',
      events.map((e, i) => ({
        // The host's own words, always. The parse only decides the mark.
        text: e.priceLabel?.trim() || (parsed[i].kind === 'free' ? 'Free' : NOT_STATED),
      })),
      { values: comparable ? parsed.map(priceRank) : events.map(() => null), label: 'Cheapest' }
    )
  );

  // ── Spots left ──
  const left = events.map(spotsLeft);
  rows.push(
    row(
      'spots',
      'Spots left',
      events.map((e, i) => ({
        text: left[i] == null ? 'Unlimited' : left[i] === 0 ? 'Full' : String(left[i]),
        detail: e.maxAttendees != null ? `${e.rsvpCount} of ${e.maxAttendees} taken` : undefined,
      })),
      // Lower rank wins everywhere, so invert: unlimited is the most room.
      { values: left.map((n) => (n == null ? -Infinity : -n)), label: 'Most room' }
    )
  );

  rows.push(row('type', 'Type', events.map((e) => ({ text: e.categoryLabel }))));
  rows.push(
    row(
      'repeats',
      'Repeats',
      events.map((e) => ({ text: e.isRecurring ? cadenceLabel(e.recurrence) || 'Repeats' : 'One-off' }))
    )
  );
  rows.push(
    row(
      'host',
      'Host',
      events.map((e) => ({ text: e.hostName, detail: e.hostVerified ? 'Verified' : undefined }))
    )
  );
  rows.push(
    row(
      'going',
      'Going',
      events.map((e) => ({ text: e.rsvpCount === 1 ? '1 person' : `${e.rsvpCount} people` }))
    )
  );
  rows.push(row('join', 'How to join', events.map((e) => ({ text: joinModeLabel(e) }))));
  rows.push(
    row(
      'age',
      'Age',
      events.map((e) => ({
        text: e.ageRestriction && e.ageRestriction !== 'none' ? `${e.ageRestriction} only` : NOT_STATED,
      }))
    )
  );
  rows.push(
    row('accessibility', 'Accessibility', events.map((e) => ({ text: e.accessibilityNotes?.trim() || NOT_STATED })))
  );
  rows.push(row('bring', 'What to bring', events.map((e) => ({ text: e.whatToBring?.trim() || NOT_STATED }))));
  rows.push(
    row(
      'tickets',
      'Tickets',
      events.map((e) => ({ text: e.ticketUrl ? 'Ticket link' : NOT_STATED }))
    )
  );

  // An attribute nobody filled in is noise, not a difference.
  return rows.filter((r) => r.cells.some((c) => c.text !== NOT_STATED));
}

/** The rows a collapsed view hides, and the ones it shows. */
export function partitionRows(rows: readonly CompareRow[]): { differing: CompareRow[]; identical: CompareRow[] } {
  return {
    differing: rows.filter((r) => !r.identical),
    identical: rows.filter((r) => r.identical),
  };
}

/**
 * Spoken label for one cell. React Native has no table semantics, so every
 * cell has to name its own row and column (plan §3.8).
 */
export function cellAccessibilityLabel(
  row: CompareRow,
  index: number,
  eventTitle: string
): string {
  const cell = row.cells[index];
  const value = cell.text || 'Not stated';
  const detail = cell.detail ? `, ${cell.detail}` : '';
  const best = row.best === index && row.bestLabel ? `. ${row.bestLabel}` : '';
  return `${row.label}, ${eventTitle}: ${value}${detail}${best}`;
}

/* ──────────────────────── adapters ──────────────────────── */

/**
 * From a browse-list row. This is what the tray stores on selection, so the
 * comparison can render columns before any details request resolves; the
 * fields `RankedEvent` lacks (age, accessibility, what to bring, rsvp mode)
 * come in later from `fromEventDetails`.
 */
export function fromRankedEvent(event: RankedEvent, startIso?: string): CompareInput {
  return {
    id: event.id,
    title: event.title,
    coverImageUrl: event.cover_image_url,
    categoryLabel: event.category_label,
    startIso: startIso ?? event.next_start_datetime ?? event.start_datetime,
    endIso: event.end_datetime,
    timezone: event.timezone ?? null,
    lat: event.lat,
    lng: event.lng,
    address: event.address,
    priceLabel: event.price_label ?? null,
    ticketUrl: event.ticket_url ?? null,
    maxAttendees: event.max_attendees ?? null,
    rsvpCount: event.rsvp_count,
    isRecurring: !!event.is_recurring,
    recurrence: event.recurrence_pattern ?? null,
    hostName: event.business_name,
    hostVerified: false,
    ageRestriction: event.age_restriction ?? null,
    accessibilityNotes: event.accessibility_notes ?? null,
    whatToBring: event.what_to_bring ?? null,
    rsvpMode: event.rsvp_mode ?? null,
    rsvpClosed: !!event.rsvp_closed,
    waitlistMode: event.waitlist_mode ?? null,
    status: event.status ?? null,
    userRsvp: event.user_rsvp ?? null,
    userSaved: !!event.user_saved,
    visibility: event.visibility ?? null,
  };
}

/** From a full `get_event_details` payload — the authoritative version. */
export function fromEventDetails(details: EventDetails, startIso?: string): CompareInput {
  const e = details.event;
  return {
    id: e.id,
    title: e.title,
    coverImageUrl: e.cover_image_url,
    categoryLabel: details.category?.label ?? '',
    startIso: startIso ?? e.start_datetime,
    endIso: e.end_datetime,
    timezone: e.timezone ?? null,
    lat: e.lat,
    lng: e.lng,
    address: e.address,
    priceLabel: e.price_label ?? null,
    ticketUrl: e.ticket_url ?? null,
    maxAttendees: e.max_attendees ?? null,
    rsvpCount: details.rsvp_count,
    isRecurring: !!e.is_recurring,
    recurrence: e.recurrence_pattern ?? null,
    hostName: details.business?.name ?? '',
    hostVerified: !!details.business?.verified,
    ageRestriction: e.age_restriction ?? null,
    accessibilityNotes: e.accessibility_notes ?? null,
    whatToBring: e.what_to_bring ?? null,
    rsvpMode: e.rsvp_mode ?? null,
    rsvpClosed: !!e.rsvp_closed,
    waitlistMode: e.waitlist_mode ?? null,
    status: e.status ?? null,
    userRsvp: details.user_rsvp ?? null,
    userSaved: !!details.user_saved,
    visibility: e.visibility ?? null,
  };
}
