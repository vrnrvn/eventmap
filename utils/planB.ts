/**
 * Plan B (docs/PLAN_B_PLAN.md §2): when an event stops being an option for
 * someone, suggest a few alternatives that fit the plan they had.
 *
 * Pure: no React, no network. The anchor is the plan that fell through
 * (where, when, what); `rankPlanB` applies the hard filters, the score and
 * the reason codes to rows the service fetched around that anchor. Same
 * input, same picks — no randomness, so it is testable and explainable.
 *
 * P1 (client-only) works from `get_ranked_events` rows, which carry no
 * status, timezone, rsvp_mode or rsvp_closed: approval-mode events cannot be
 * labelled or down-ranked yet, and a series' sessions are computed in the
 * device zone. The P2 RPC (`get_plan_b_events`) closes both.
 */
import { listOccurrences, type OccurrenceException } from '@/utils/occurrences';
import { formatDistance } from '@/utils/formatEventWhen';
import type { RankedEvent } from '@/types/database';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** The moments Plan B serves on the client (§1: T1, T2, T3, T5). */
export type PlanBReason = 'cancelled' | 'date_cancelled' | 'full' | 'late';

/** Why a pick fits, as codes; `planBReasonLabel` turns them into copy. */
export type PlanBReasonCode = 'same_category' | 'interest' | 'time_close' | 'near_anchor' | 'same_host' | 'has_room';

/** Tunables (§2.2–2.3). */
export const PLAN_B = {
  radiusKm: 10,
  wideRadiusKm: 25,
  /** Fewer picks than this at `radiusKm` → one retry at `wideRadiusKm`. */
  sparseBelow: 3,
  limit: 3,
  /** T1–T3: candidates may start this long before the anchor's start… */
  beforeMs: 2 * HOUR,
  /** …and this long after its end. */
  afterMs: 1 * HOUR,
  /** T1–T3: an event already running at the anchor's start needs this much left. */
  inProgressMinLeftMs: 45 * MIN,
  /** T5: a live event needs this much left to be worth heading to. */
  lateMinLeftMs: 30 * MIN,
  /** T5: or it starts within this window (the live page's "starting soon"). */
  lateSoonMs: 60 * MIN,
  /** "Starts around the same time": within this of the anchor's start. */
  timeCloseMs: 30 * MIN,
  /** "Near the original": within this many km (chip only; scoring is continuous). */
  nearKm: 2,
  /** "N spots left" is worth saying at or below this. */
  fewSpots: 10,
} as const;

export type PlanBAnchor = {
  reason: PlanBReason;
  eventId: string;
  businessId: string;
  categoryId: string | null;
  categoryLabel: string | null;
  /** Where to search from: the venue (T1–T3), the viewer if known (T5). */
  lat: number;
  lng: number;
  /** The session that fell through (T5: "from now"). */
  start: Date;
  end: Date;
  /** Candidate starts must fall in [windowStart, windowEnd]… */
  windowStart: Date;
  windowEnd: Date;
  /** …or be running at `inProgressAt` with at least `minLeftMs` to go. */
  inProgressAt: Date;
  minLeftMs: number;
  /** T2: the cancelled date (event-zone key). */
  dateKey?: string;
};

type AnchorEvent = {
  id: string;
  business_id: string;
  category_id?: string | null;
  lat: number;
  lng: number;
};

/**
 * The anchor for a moment, or null when a Plan B can no longer help (the
 * window is already over).
 *
 * `session` is the session that fell through: the one-off's own times, the
 * cancelled date (T2), or the running/next session of a series (T1/T3). The
 * caller computes it, since it already holds the exceptions and the clock
 * (the rehearsal preview has a virtual one).
 */
export function planBAnchor(input: {
  reason: PlanBReason;
  event: AnchorEvent;
  categoryLabel?: string | null;
  session: { start: Date; end: Date; dateKey?: string };
  now: Date;
  /** T5: the viewer's position, when the device shared it. */
  viewer?: { lat: number; lng: number } | null;
}): PlanBAnchor | null {
  const { reason, event, session, now } = input;
  const base = {
    reason,
    eventId: event.id,
    businessId: event.business_id,
    categoryId: event.category_id ?? null,
    categoryLabel: input.categoryLabel ?? null,
    dateKey: session.dateKey,
  };
  if (reason === 'late') {
    const at = input.viewer ?? { lat: event.lat, lng: event.lng };
    return {
      ...base,
      lat: at.lat,
      lng: at.lng,
      start: now,
      end: session.end,
      windowStart: now,
      windowEnd: new Date(now.getTime() + PLAN_B.lateSoonMs),
      inProgressAt: now,
      minLeftMs: PLAN_B.lateMinLeftMs,
    };
  }
  const windowStart = new Date(session.start.getTime() - PLAN_B.beforeMs);
  const windowEnd = new Date(session.end.getTime() + PLAN_B.afterMs);
  // Nothing left to rescue: the evening the plan was for is over.
  if (windowEnd.getTime() <= now.getTime()) return null;
  return {
    ...base,
    lat: event.lat,
    lng: event.lng,
    start: session.start,
    end: session.end,
    windowStart,
    windowEnd,
    inProgressAt: session.start,
    minLeftMs: PLAN_B.inProgressMinLeftMs,
  };
}

/** A row from the live page carries its running/next session already. */
type CandidateRow = RankedEvent & { occ_start?: string; occ_end?: string };

/**
 * The candidate's session that fits the anchor's window, or null. One-offs
 * have one; a series is walked (exceptions applied) from just before the
 * window, so a skipped date is never suggested and a moved one is.
 */
export function candidateSession(
  row: CandidateRow,
  anchor: PlanBAnchor,
  exceptions: readonly OccurrenceException[],
  now: Date
): { start: Date; end: Date } | null {
  const fits = (start: Date, end: Date) => {
    if (end.getTime() <= now.getTime()) return false;
    const s = start.getTime();
    if (s >= anchor.windowStart.getTime() && s <= anchor.windowEnd.getTime()) return true;
    // Already running when the plan was due to start, with enough left.
    const at = Math.max(anchor.inProgressAt.getTime(), now.getTime());
    return s <= at && end.getTime() - at >= anchor.minLeftMs;
  };
  if (row.occ_start && row.occ_end) {
    const start = new Date(row.occ_start);
    const end = new Date(row.occ_end);
    return fits(start, end) ? { start, end } : null;
  }
  if (!row.is_recurring || !row.recurrence_pattern) {
    const start = new Date(row.start_datetime);
    const end = new Date(row.end_datetime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return fits(start, end) ? { start, end } : null;
  }
  const duration = Math.max(new Date(row.end_datetime).getTime() - new Date(row.start_datetime).getTime(), 0);
  const from = new Date(Math.min(anchor.windowStart.getTime(), anchor.inProgressAt.getTime()) - duration);
  const own = exceptions.filter((x) => x.event_id === row.id);
  const hit = listOccurrences(row, own, { count: 6, now: from, includeCancelled: false }).find((o) => fits(o.start, o.end));
  return hit ? { start: hit.start, end: hit.end } : null;
}

export type PlanBPick = {
  event: RankedEvent;
  start: Date;
  end: Date;
  score: number;
  /** Most telling first; the UI shows up to three. */
  reasons: PlanBReasonCode[];
  /** null = no cap. */
  spotsLeft: number | null;
};

/**
 * Hard filters, score and reasons (§2.2–2.4). `rows` must be fetched around
 * the anchor (their `distance_km` is measured from it).
 */
export function rankPlanB(
  anchor: PlanBAnchor,
  rows: readonly CandidateRow[],
  opts: {
    now: Date;
    exceptions?: readonly OccurrenceException[];
    preferredCategoryIds?: readonly string[] | null;
    radiusKm?: number;
    limit?: number;
  }
): PlanBPick[] {
  const radius = opts.radiusKm ?? PLAN_B.radiusKm;
  const prefs = new Set(opts.preferredCategoryIds ?? []);
  const seen = new Set<string>();
  const picks: PlanBPick[] = [];
  for (const row of rows) {
    if (row.id === anchor.eventId || seen.has(row.id)) continue;
    seen.add(row.id);
    // The ranked RPC only returns active rows and has no status column; a
    // row that does carry one (other sources, the fake) must say active.
    if (row.status !== undefined && row.status !== 'active') continue;
    // Already part of their plans.
    if (row.user_rsvp === 'going' || row.user_rsvp === 'requested') continue;
    const distance = Number(row.distance_km);
    if (!Number.isFinite(distance) || distance > radius) continue;
    const spotsLeft = row.max_attendees == null ? null : row.max_attendees - (row.rsvp_count ?? 0);
    if (spotsLeft != null && spotsLeft <= 0) continue;
    const session = candidateSession(row, anchor, opts.exceptions ?? [], opts.now);
    if (!session) continue;

    const sameCategory = !!anchor.categoryId && row.category_id === anchor.categoryId;
    const interest = !!row.category_id && prefs.has(row.category_id);
    const sameHost = row.business_id === anchor.businessId;
    const timeRef = anchor.reason === 'late' ? opts.now : anchor.start;
    const offset = Math.abs(session.start.getTime() - timeRef.getTime());
    const runningAtRef = session.start.getTime() <= timeRef.getTime() && session.end.getTime() > timeRef.getTime();
    // 0.8 within ±30 min (or running at the reference time), down to 0 at the window's edge.
    const edge = Math.max(
      Math.abs(anchor.windowEnd.getTime() - timeRef.getTime()),
      Math.abs(timeRef.getTime() - anchor.windowStart.getTime()),
      PLAN_B.timeCloseMs + 1
    );
    const timeFit =
      runningAtRef || offset <= PLAN_B.timeCloseMs
        ? 0.8
        : Math.max(0, 0.8 * (1 - (offset - PLAN_B.timeCloseMs) / (edge - PLAN_B.timeCloseMs)));
    const distanceFit = 0.8 * (1 - Math.min(distance / radius, 1));
    const score =
      (sameCategory ? 1 : 0) +
      (interest ? 0.4 : 0) +
      timeFit +
      distanceFit +
      (sameHost ? 0.2 : 0) +
      0.1 * Math.log(1 + Math.max(0, row.rsvp_count ?? 0));

    const reasons: PlanBReasonCode[] = [];
    if (sameCategory) reasons.push('same_category');
    else if (interest) reasons.push('interest');
    if (runningAtRef || offset <= PLAN_B.timeCloseMs) reasons.push('time_close');
    if (distance <= PLAN_B.nearKm) reasons.push('near_anchor');
    if (sameHost) reasons.push('same_host');
    if (spotsLeft != null && spotsLeft <= PLAN_B.fewSpots) reasons.push('has_room');

    picks.push({ event: row, start: session.start, end: session.end, score, reasons, spotsLeft });
  }
  picks.sort(
    (a, b) =>
      b.score - a.score || a.start.getTime() - b.start.getTime() || (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0)
  );
  return picks.slice(0, opts.limit ?? PLAN_B.limit);
}

/** A reason chip in the viewer's words. */
export function planBReasonLabel(code: PlanBReasonCode, pick: PlanBPick, anchor: PlanBAnchor, now: Date): string {
  switch (code) {
    case 'same_category':
      return anchor.categoryLabel ? `Also ${anchor.categoryLabel.toLowerCase()}` : 'Same kind of event';
    case 'interest':
      return 'One of your interests';
    case 'time_close': {
      if (anchor.reason === 'late') {
        if (pick.start.getTime() <= now.getTime()) return 'Happening now';
        return `Starts in ${Math.max(1, Math.round((pick.start.getTime() - now.getTime()) / MIN))} min`;
      }
      const diff = Math.round((pick.start.getTime() - anchor.start.getTime()) / MIN);
      // Started well before (> 30 min) and still running then: the start
      // time is beside the point.
      if (-diff * MIN > PLAN_B.timeCloseMs && pick.end.getTime() > anchor.start.getTime()) {
        return 'Already on by then';
      }
      if (Math.abs(diff) <= 5) return 'Same time';
      return diff > 0 ? `Starts ${diff} min later` : `Starts ${-diff} min earlier`;
    }
    case 'near_anchor': {
      const km = Number(pick.event.distance_km);
      return anchor.reason === 'late' ? `${formatDistance(km)} away` : `${formatDistance(km)} from the original`;
    }
    case 'same_host':
      return 'Same host';
    case 'has_room':
      return pick.spotsLeft === 1 ? '1 spot left' : `${pick.spotsLeft} spots left`;
  }
}

/** Up to three chips, most telling first. */
export function planBChips(pick: PlanBPick, anchor: PlanBAnchor, now: Date): string[] {
  return pick.reasons.slice(0, 3).map((c) => planBReasonLabel(c, pick, anchor, now));
}

/** Section copy per moment (§3.1). */
export function planBSectionCopy(anchor: PlanBAnchor, dateLabel?: string): { title: string; subtitle: string } {
  switch (anchor.reason) {
    case 'cancelled':
      return { title: 'Still want to go out?', subtitle: 'Similar events around the same time, near where you were going.' };
    case 'date_cancelled':
      return {
        title: dateLabel ? `${dateLabel} is cancelled — here's what else is on` : "Here's what else is on that day",
        subtitle: 'Around the same time, near the usual venue.',
      };
    case 'full':
      return { title: "Full — here's what else is on then", subtitle: 'Keep your waitlist spot and have a backup.' };
    case 'late':
      return { title: "Here's what's on later nearby", subtitle: 'Running now with time to spare, or starting within the hour.' };
  }
}
