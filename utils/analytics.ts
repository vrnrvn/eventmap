/**
 * Pure helpers for host analytics (docs/ANALYTICS_AND_CALENDAR_PLAN.md §1.4).
 * No React Native imports, unit-tested under node (tests/analytics.test.ts).
 *
 * `get_event_insights` (20261104100000) is tiered on the server: the free
 * tier gets counts and the funnel, premium adds the sections that are null
 * here on free. `parseEventInsights` turns the raw JSON into this shape
 * defensively, so a missing or malformed field never crashes the screen.
 */

export type AnalyticsTier = 'free' | 'premium';

export type InsightsTotals = {
  views: number;
  uniqueViewers: number;
  viewsPeriod: number;
  saves: number;
  savesPeriod: number;
  going: number;
  goingPeriod: number;
  interested: number;
  requested: number;
  waitlist: number;
  removed: number;
  /** going / capacity, 0..1+; null when the event has no cap. */
  fillRate: number | null;
  /** Ratios against unique viewers (0 when nobody has viewed yet). */
  viewToSave: number;
  viewToGoing: number;
};

export type InsightsTrendPoint = {
  date: string;
  views: number;
  saves: number;
  going: number;
  goingCumulative: number;
};

export type LeadTime =
  | { available: false; reason: string }
  | { available: true; sameDay: number; d1to3: number; d4to7: number; d8to14: number; d15plus: number };

export type InteractionCounts = { share: number; ticket: number; calendar: number; directions: number; period: number };

export type RsvpChanges = {
  /** First recorded change for this event; null when nothing was recorded yet. */
  trackedSince: string | null;
  joined: number;
  /** Went from going to no RSVP on their own. */
  left: number;
  /** Went from going to interested. */
  downgraded: number;
  declined: number;
  removed: number;
};

export type EventInsights = {
  tier: AnalyticsTier;
  periodDays: number;
  event: {
    id: string;
    title: string;
    startDatetime: string;
    timezone: string | null;
    status: string;
    maxAttendees: number | null;
    isRecurring: boolean;
    rsvpMode: string | null;
  };
  totals: InsightsTotals;
  // Premium-only; null on the free tier.
  trend: InsightsTrendPoint[] | null;
  leadTime: LeadTime | null;
  audience: { followersGoing: number; returningGoing: number; firstTimeGoing: number } | null;
  announcements: { sent: number; recipients: number; read: number } | null;
  chat: { messages: number; activeSenders: number; messagesPeriod: number } | null;
  businessMedian: { events: number; views: number; going: number } | null;
  /** Taps on the event page (20261104090000); all-time counts plus the window total. */
  interactions: InteractionCounts | null;
  /** RSVP movement inside the window (20261104090000). */
  rsvpChanges: RsvpChanges | null;
  /**
   * 'insights_rpc' when get_event_insights answered; 'overview_fallback'
   * while that migration isn't applied (counts from the host overview,
   * premium sections unavailable rather than locked).
   */
  source: 'insights_rpc' | 'overview_fallback';
};

type Raw = Record<string, unknown> | null | undefined;

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v, NaN)) ?? null;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function cleanNullableNumber(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null || Number.isNaN(n) ? null : n;
}

export function parseEventInsights(raw: unknown): EventInsights {
  const r = obj(raw) ?? {};
  const e = obj(r.event) ?? {};
  const t = obj(r.totals) ?? {};
  const lead = obj(r.lead_time);
  const aud = obj(r.audience);
  const ann = obj(r.announcements);
  const chat = obj(r.chat);
  const med = obj(r.business_median);
  const taps = obj(r.interactions);
  const moves = obj(r.rsvp_changes);
  return {
    tier: r.tier === 'premium' ? 'premium' : 'free',
    periodDays: num(r.period_days, 30),
    event: {
      id: str(e.id),
      title: str(e.title),
      startDatetime: str(e.start_datetime),
      timezone: typeof e.timezone === 'string' ? e.timezone : null,
      status: str(e.status, 'active'),
      maxAttendees: cleanNullableNumber(e.max_attendees),
      isRecurring: e.is_recurring === true,
      rsvpMode: typeof e.rsvp_mode === 'string' ? e.rsvp_mode : null,
    },
    totals: {
      views: num(t.views),
      uniqueViewers: num(t.unique_viewers),
      viewsPeriod: num(t.views_period),
      saves: num(t.saves),
      savesPeriod: num(t.saves_period),
      going: num(t.going),
      goingPeriod: num(t.going_period),
      interested: num(t.interested),
      requested: num(t.requested),
      waitlist: num(t.waitlist),
      removed: num(t.removed),
      fillRate: cleanNullableNumber(t.fill_rate),
      viewToSave: num(t.view_to_save),
      viewToGoing: num(t.view_to_going),
    },
    trend: Array.isArray(r.trend)
      ? r.trend.map((p) => {
          const q = obj(p) ?? {};
          return {
            date: str(q.date),
            views: num(q.views),
            saves: num(q.saves),
            going: num(q.going),
            goingCumulative: num(q.going_cumulative),
          };
        })
      : null,
    leadTime: !lead
      ? null
      : lead.available === false
        ? { available: false, reason: str(lead.reason, 'unavailable') }
        : {
            available: true,
            sameDay: num(lead.same_day),
            d1to3: num(lead.d1_3),
            d4to7: num(lead.d4_7),
            d8to14: num(lead.d8_14),
            d15plus: num(lead.d15_plus),
          },
    audience: aud
      ? {
          followersGoing: num(aud.followers_going),
          returningGoing: num(aud.returning_going),
          firstTimeGoing: num(aud.first_time_going),
        }
      : null,
    announcements: ann ? { sent: num(ann.sent), recipients: num(ann.recipients), read: num(ann.read) } : null,
    chat: chat
      ? { messages: num(chat.messages), activeSenders: num(chat.active_senders), messagesPeriod: num(chat.messages_period) }
      : null,
    businessMedian: med ? { events: num(med.events), views: num(med.views), going: num(med.going) } : null,
    interactions: taps
      ? {
          share: num(taps.share),
          ticket: num(taps.ticket),
          calendar: num(taps.calendar),
          directions: num(taps.directions),
          period: num(taps.period),
        }
      : null,
    rsvpChanges: moves
      ? {
          trackedSince: typeof moves.tracked_since === 'string' ? moves.tracked_since : null,
          joined: num(moves.joined),
          left: num(moves.left),
          downgraded: num(moves.downgraded),
          declined: num(moves.declined),
          removed: num(moves.removed),
        }
      : null,
    source: 'insights_rpc',
  };
}

/** "42%" from a 0..1 ratio; whole numbers, "<1%" for tiny non-zero values. */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '0%';
  const pct = ratio * 100;
  if (pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

export type FunnelStep = { key: 'views' | 'saves' | 'going'; label: string; value: number; ratioOfFirst: number };

/**
 * Viewers → saves → going. The base is unique viewers (one person counted
 * once), which is what the conversion ratios are measured against.
 */
export function funnelSteps(totals: Pick<InsightsTotals, 'uniqueViewers' | 'saves' | 'going'>): FunnelStep[] {
  const base = totals.uniqueViewers;
  const ratio = (v: number) => (base > 0 ? v / base : 0);
  return [
    { key: 'views', label: 'Viewed', value: base, ratioOfFirst: base > 0 ? 1 : 0 },
    { key: 'saves', label: 'Saved', value: totals.saves, ratioOfFirst: ratio(totals.saves) },
    { key: 'going', label: 'Going', value: totals.going, ratioOfFirst: ratio(totals.going) },
  ];
}

export const LEAD_TIME_BUCKETS = [
  { key: 'sameDay', label: 'Same day' },
  { key: 'd1to3', label: '1–3 days' },
  { key: 'd4to7', label: '4–7 days' },
  { key: 'd8to14', label: '1–2 weeks' },
  { key: 'd15plus', label: '2+ weeks' },
] as const;

export type LeadTimeSummary = {
  buckets: { key: string; label: string; value: number; share: number }[];
  total: number;
  /** "Most people RSVP 1–3 days before"; null with no RSVPs. */
  reading: string | null;
};

export function leadTimeSummary(lead: Extract<LeadTime, { available: true }>): LeadTimeSummary {
  const values = LEAD_TIME_BUCKETS.map((b) => ({ key: b.key, label: b.label, value: lead[b.key] }));
  const total = values.reduce((n, b) => n + b.value, 0);
  const buckets = values.map((b) => ({ ...b, share: total > 0 ? b.value / total : 0 }));
  if (total === 0) return { buckets, total, reading: null };
  const top = buckets.reduce((best, b) => (b.value > best.value ? b : best), buckets[0]);
  const reading =
    top.key === 'sameDay'
      ? 'Most people RSVP on the day itself'
      : `Most people RSVP ${top.label.replace('+', ' or more').toLowerCase()} before`;
  return { buckets, total, reading };
}

export type MedianDelta = { direction: 'up' | 'down' | 'same'; label: string };

/**
 * "2× your usual" / "40% below your usual" / "About your usual" against the
 * business median. Null when there is no median or both are zero.
 */
export function deltaVsMedian(value: number, median: number | null | undefined): MedianDelta | null {
  if (median === null || median === undefined || !Number.isFinite(median)) return null;
  if (median <= 0) return value > 0 ? { direction: 'up', label: 'Above your usual' } : null;
  const ratio = value / median;
  if (ratio >= 0.9 && ratio <= 1.1) return { direction: 'same', label: 'About your usual' };
  if (ratio >= 2) return { direction: 'up', label: `${Math.round(ratio * 10) / 10}× your usual` };
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  return ratio > 1
    ? { direction: 'up', label: `${pct}% above your usual` }
    : { direction: 'down', label: `${pct}% below your usual` };
}

/** Max of a numeric field across trend points (1 when empty, so bars never divide by zero). */
export function trendMax<T>(points: readonly T[], pick: (p: T) => number): number {
  return points.reduce((m, p) => Math.max(m, pick(p)), 0) || 1;
}

/** Read rate of announcements, 0..1 (0 when nothing was delivered). */
export function announcementReadRate(a: { recipients: number; read: number }): number {
  return a.recipients > 0 ? Math.min(a.read / a.recipients, 1) : 0;
}

export const INTERACTION_LABELS: { key: Exclude<keyof InteractionCounts, 'period'>; label: string }[] = [
  { key: 'share', label: 'Shared' },
  { key: 'calendar', label: 'Added to calendar' },
  { key: 'directions', label: 'Asked for directions' },
  { key: 'ticket', label: 'Opened the ticket link' },
];

/** Total taps across kinds. */
export function interactionTotal(c: Pick<InteractionCounts, 'share' | 'ticket' | 'calendar' | 'directions'>): number {
  return c.share + c.ticket + c.calendar + c.directions;
}

/**
 * One line about commitment drift in the window, e.g. "3 joined, 1 left and
 * 1 switched to interested in the last 30 days". Null when nothing moved.
 * Host decisions (declined / removed) are not drop-off and are left out.
 */
export function describeRsvpChanges(c: RsvpChanges, days: number): string | null {
  const parts: string[] = [];
  if (c.joined > 0) parts.push(`${c.joined} joined`);
  if (c.left > 0) parts.push(`${c.left} left`);
  if (c.downgraded > 0) parts.push(`${c.downgraded} switched to interested`);
  if (parts.length === 0) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${list} in the last ${days} days`;
}

/** Share of people who joined in the window and later left or downgraded (0..1); null without joins. */
export function dropOffRate(c: RsvpChanges): number | null {
  if (c.joined <= 0) return null;
  return Math.min((c.left + c.downgraded) / c.joined, 1);
}
