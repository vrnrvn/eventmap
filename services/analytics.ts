import { supabase } from './supabase';

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
};

export type BusinessAnalytics = {
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

    return {
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
};
