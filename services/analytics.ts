import { supabase } from './supabase';
import { eventsService } from './events';
import { hostToolsService, isMissingDbFunction } from './hostTools';
import { parseEventInsights, type EventInsights } from '@/utils/analytics';

export type { EventInsights };

/** The caller isn't the event's host (or an admin). */
export class InsightsForbiddenError extends Error {
  constructor() {
    super('Only the host business can view insights for this event.');
    this.name = 'InsightsForbiddenError';
  }
}

export class InsightsNotFoundError extends Error {
  constructor() {
    super('Event not found.');
    this.name = 'InsightsNotFoundError';
  }
}

/** The prepared RPC isn't in the generated types yet. */
const untypedRpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => ReturnType<typeof supabase.rpc>)(fn, args);

export type AnalyticsTrendPoint = {
  date: string;
  views: number;
  saves: number;
  rsvps: number;
};

export type AnalyticsTopEvent = {
  id: string;
  title: string;
  views: number;
  saves: number;
  rsvps: number;
  conversion: number;
  /** 20261104100000; null on older backends. */
  startDatetime: string | null;
  status: string | null;
};

export type BusinessAnalytics = {
  /**
   * Server-decided tier (20261104100000): 'free' gets totals only, with
   * trend / topEvents empty. null on older backends, where the screen keeps
   * gating on the client's premium state.
   */
  tier: 'free' | 'premium' | null;
  periodDays: number;
  /** Window totals (20261104100000); null on older backends. */
  periodViews: number | null;
  periodSaves: number | null;
  periodRsvps: number | null;
  /** Premium window tap totals (20261104090000); null on free or older backends. */
  interactionTotals: { share: number; ticket: number; calendar: number; directions: number } | null;
  totalPosts: number;
  postsThisPeriod: number;
  recurringPosts: number;
  upcomingEvents: number;
  totalViews: number;
  totalSaves: number;
  totalRsvps: number;
  engagementRate: number;
  followerTotal: number;
  followersThisPeriod: number;
  averageRating: number;
  reviewCount: number;
  topEvents: AnalyticsTopEvent[];
  trend: AnalyticsTrendPoint[];
};

const EMPTY_ANALYTICS: BusinessAnalytics = {
  tier: null,
  periodDays: 30,
  periodViews: null,
  periodSaves: null,
  periodRsvps: null,
  interactionTotals: null,
  totalPosts: 0,
  postsThisPeriod: 0,
  recurringPosts: 0,
  upcomingEvents: 0,
  totalViews: 0,
  totalSaves: 0,
  totalRsvps: 0,
  engagementRate: 0,
  followerTotal: 0,
  followersThisPeriod: 0,
  averageRating: 0,
  reviewCount: 0,
  topEvents: [],
  trend: [],
};

export const analyticsService = {
  async getBusinessAnalytics(
    businessId: string,
    days = 30
  ): Promise<BusinessAnalytics> {
    const { data, error } = await (supabase as any).rpc(
      'get_business_analytics',
      {
        business_uuid: businessId,
        days,
      }
    );

    if (error) {
      const message = String(error.message || '');
      const code = String((error as any).code || '');

      if (
        code === '42883' ||
        code === '42P01' ||
        message.includes('get_business_analytics') ||
        message.includes('event_views')
      ) {
        throw new Error(
          'Analytics backend is not initialized. Apply the latest Supabase migrations, including 20260225000000_add_real_business_analytics.sql.'
        );
      }

      if (message.toLowerCase().includes('not authorized')) {
        throw new Error('You are not authorized to view analytics for this business.');
      }

      throw new Error(message || 'Failed to fetch analytics.');
    }

    if (!data || typeof data !== 'object') return EMPTY_ANALYTICS;

    const raw = data as any;

    const optionalNumber = (v: unknown) => (v === undefined || v === null ? null : Number(v));
    return {
      tier: raw.tier === 'premium' || raw.tier === 'free' ? raw.tier : null,
      periodDays: Number(raw.periodDays || days),
      periodViews: optionalNumber(raw.periodViews),
      periodSaves: optionalNumber(raw.periodSaves),
      periodRsvps: optionalNumber(raw.periodRsvps),
      interactionTotals:
        raw.interactionTotals && typeof raw.interactionTotals === 'object'
          ? {
              share: Number(raw.interactionTotals.share || 0),
              ticket: Number(raw.interactionTotals.ticket || 0),
              calendar: Number(raw.interactionTotals.calendar || 0),
              directions: Number(raw.interactionTotals.directions || 0),
            }
          : null,
      totalPosts: Number(raw.totalPosts || 0),
      postsThisPeriod: Number(raw.postsThisPeriod || 0),
      recurringPosts: Number(raw.recurringPosts || 0),
      upcomingEvents: Number(raw.upcomingEvents || 0),
      totalViews: Number(raw.totalViews || 0),
      totalSaves: Number(raw.totalSaves || 0),
      totalRsvps: Number(raw.totalRsvps || 0),
      engagementRate: Number(raw.engagementRate || 0),
      followerTotal: Number(raw.followerTotal || 0),
      followersThisPeriod: Number(raw.followersThisPeriod || 0),
      averageRating: Number(raw.averageRating || 0),
      reviewCount: Number(raw.reviewCount || 0),
      topEvents: Array.isArray(raw.topEvents)
        ? raw.topEvents.map((event: any) => ({
            id: String(event.id),
            title: String(event.title || ''),
            views: Number(event.views || 0),
            saves: Number(event.saves || 0),
            rsvps: Number(event.rsvps || 0),
            conversion: Number(event.conversion || 0),
            startDatetime: typeof event.start_datetime === 'string' ? event.start_datetime : null,
            status: typeof event.status === 'string' ? event.status : null,
          }))
        : [],
      trend: Array.isArray(raw.trend)
        ? raw.trend.map((point: any) => ({
            date: String(point.date || ''),
            views: Number(point.views || 0),
            saves: Number(point.saves || 0),
            rsvps: Number(point.rsvps || 0),
          }))
        : [],
    };
  },

  /**
   * Per-event insights (20261104100000), tiered on the server. While that
   * migration isn't applied, falls back to the host overview counts
   * (`source: 'overview_fallback'`): the screen then shows the counts and
   * marks the time-series sections as unavailable instead of locked.
   */
  async getEventInsights(eventId: string, days = 30): Promise<EventInsights> {
    const { data, error } = await untypedRpc('get_event_insights', { p_event_id: eventId, p_days: days });
    if (!error) return parseEventInsights(data);

    const message = String(error.message || '');
    if (message.includes('not_allowed')) throw new InsightsForbiddenError();
    if (message.includes('event_not_found')) throw new InsightsNotFoundError();
    if (!isMissingDbFunction(error)) throw new Error(message || 'Failed to load insights.');

    return insightsFromOverview(eventId);
  },
};

async function insightsFromOverview(eventId: string): Promise<EventInsights> {
  const details = await eventsService.getEventDetails(eventId);
  if (!details) throw new InsightsNotFoundError();
  // The host overview RPC refuses non-hosts; surface that the same way.
  let overview;
  try {
    overview = await hostToolsService.getOverview(eventId, details);
  } catch (err) {
    if (String((err as { message?: unknown })?.message ?? '').includes('not_allowed')) {
      throw new InsightsForbiddenError();
    }
    throw err;
  }
  const event = details.event;
  const going = overview.going;
  const views = overview.views_total ?? 0;
  const cap = event.max_attendees ?? null;
  return {
    tier: 'free',
    periodDays: 7,
    event: {
      id: event.id,
      title: event.title,
      startDatetime: event.start_datetime,
      timezone: event.timezone ?? null,
      status: event.status ?? 'active',
      maxAttendees: cap,
      isRecurring: !!event.is_recurring,
      rsvpMode: event.rsvp_mode ?? null,
    },
    totals: {
      views,
      // The overview has no distinct count; views are already one per person per day.
      uniqueViewers: views,
      viewsPeriod: overview.views_7d ?? 0,
      saves: overview.saves,
      savesPeriod: 0,
      going,
      goingPeriod: 0,
      interested: overview.interested ?? 0,
      requested: overview.requested ?? 0,
      waitlist: overview.waitlist ?? 0,
      removed: overview.removed ?? 0,
      fillRate: cap && cap > 0 ? going / cap : null,
      viewToSave: views > 0 ? overview.saves / views : 0,
      viewToGoing: views > 0 ? going / views : 0,
    },
    trend: null,
    leadTime: null,
    audience: null,
    announcements: null,
    chat: null,
    businessMedian: null,
    interactions: null,
    rsvpChanges: null,
    source: 'overview_fallback',
  };
}
