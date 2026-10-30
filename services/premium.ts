// services/premium.ts
//
// Single source of truth for premium status: the `businesses` row in the DB
// (`subscription_tier` + `subscription_expires_at`). The DB only knows two
// tiers — 'free' and 'premium' (CHECK constraint) — and server-side functions
// (check_event_creation_limit, recurring-events trigger) gate on
// subscription_tier = 'premium', so the client catalog below maps the "pro"
// plan to the DB tier 'premium'.
//
// Payments are simulated (no billing provider). Subscribing writes the tier
// and sets subscription_expires_at one month/year out; there is NO automatic
// renewal, so the subscription simply lapses when subscription_expires_at
// passes. Cancelling downgrades immediately. All UI copy must match this.

import { supabase } from './supabase';
import { businessesService } from './businesses';
import { Business } from '@/types/database';

/**
 * True when an RPC failed because the function does not exist yet (the
 * 202610301xxxxx migrations have not been applied): Postgres 42883
 * (undefined_function) or PostgREST PGRST202 (function not in schema cache).
 */
function isMissingDbFunction(error: { code?: string } | null): boolean {
  return !!error && (error.code === '42883' || error.code === 'PGRST202');
}

export interface PremiumPlan {
  id: string;
  slug: string;
  name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  max_events: number;
  max_photos_per_event: number;
  boost_multiplier: number;
  analytics_enabled: boolean;
  highlighted_markers: boolean;
  recurring_events: boolean;
  sort_order: number;
  features: string[];
}

export interface BusinessSubscription {
  business_id: string;
  plan_slug: string;
  status: 'active';
  /** Period end = businesses.subscription_expires_at. Null = no expiry set. */
  current_period_end: string | null;
}

// Values mirror what the DB actually enforces: free = 2 events/month,
// premium = 30 events/month (check_event_creation_limit). Photo limits are
// client-enforced only, via ImagePickerButton maxImages.
const PLANS: PremiumPlan[] = [
  {
    id: 'plan-free',
    slug: 'free',
    name: 'Free',
    description: 'Get started with basic event posting',
    price_monthly: 0,
    price_yearly: 0,
    max_events: 2,
    max_photos_per_event: 5,
    boost_multiplier: 1.0,
    analytics_enabled: false,
    highlighted_markers: false,
    recurring_events: false,
    sort_order: 0,
    features: [
      'Up to 2 events per month',
      'Up to 5 photos per event',
      'Basic map marker',
      'Standard placement',
    ],
  },
  {
    id: 'plan-pro',
    slug: 'pro',
    name: 'Pro',
    description: 'Full-featured for growing businesses',
    price_monthly: 2999,
    price_yearly: 29990,
    max_events: 30,
    max_photos_per_event: 15,
    boost_multiplier: 3.0,
    analytics_enabled: true,
    highlighted_markers: true,
    recurring_events: true,
    sort_order: 1,
    features: [
      'Up to 30 events per month',
      'Up to 15 photos per event',
      'Recurring events',
      'Analytics dashboard',
      'Highlighted map markers',
      'Boosted placement',
      'Priority support',
    ],
  },
];

const FREE_PLAN = PLANS[0];
const PRO_PLAN = PLANS[1];

function isExpired(business: Business): boolean {
  if (!business.subscription_expires_at) return false;
  return new Date(business.subscription_expires_at).getTime() <= Date.now();
}

export const premiumService = {
  getPlans(): PremiumPlan[] {
    return PLANS;
  },

  getPlanBySlug(slug: string): PremiumPlan | undefined {
    return PLANS.find((p) => p.slug === slug);
  },

  async getSubscription(
    businessId: string
  ): Promise<BusinessSubscription | null> {
    const business = await businessesService.getBusiness(businessId);
    if (!business || business.subscription_tier !== 'premium') return null;

    if (isExpired(business)) {
      // Lapsed: downgrade the row so server-side gating agrees with the UI.
      try {
        await this.cancelSubscription(businessId);
      } catch (err) {
        console.error('Failed to downgrade lapsed subscription:', err);
      }
      return null;
    }

    return {
      business_id: business.id,
      plan_slug: 'pro',
      status: 'active',
      current_period_end: business.subscription_expires_at,
    };
  },

  async getFeatureLimits(businessId: string): Promise<PremiumPlan> {
    const sub = await this.getSubscription(businessId);
    return sub ? PRO_PLAN : FREE_PLAN;
  },

  async getEventCount(businessId: string): Promise<number> {
    const { currentCount } = await businessesService.checkEventLimit(
      businessId
    );
    return currentCount;
  },

  canUseFeature(
    plan: PremiumPlan,
    feature:
      | 'analytics'
      | 'highlighted_markers'
      | 'recurring_events'
      | 'multi_photos'
  ): boolean {
    switch (feature) {
      case 'analytics':
        return plan.analytics_enabled;
      case 'highlighted_markers':
        return plan.highlighted_markers;
      case 'recurring_events':
        return plan.recurring_events;
      case 'multi_photos':
        return plan.max_photos_per_event > 1;
    }
  },

  canCreateEvent(plan: PremiumPlan, currentEventCount: number): boolean {
    if (plan.max_events === -1) return true;
    return currentEventCount < plan.max_events;
  },

  /**
   * Simulated checkout (no payment is collected). Goes through the
   * SECURITY DEFINER RPC (owner-validated, sets tier='premium' and the expiry
   * one month/year out server-side). Falls back to a direct table update while
   * the RPC migration has not been applied yet.
   */
  async subscribeToPlan(
    businessId: string,
    planSlug: string,
    billingCycle: 'monthly' | 'yearly'
  ): Promise<{ success: boolean }> {
    if (planSlug === 'free') {
      return this.cancelSubscription(businessId);
    }

    const { error } = await (supabase as any).rpc(
      'activate_premium_simulation',
      {
        p_business_id: businessId,
        p_interval: billingCycle,
      }
    );
    if (!error) return { success: true };
    if (!isMissingDbFunction(error)) throw error;

    // TODO: remove fallback once 2026103xx migrations are applied
    const expires = new Date();
    if (billingCycle === 'yearly') {
      expires.setFullYear(expires.getFullYear() + 1);
    } else {
      expires.setMonth(expires.getMonth() + 1);
    }
    await businessesService.updateBusiness(businessId, {
      subscription_tier: 'premium',
      subscription_expires_at: expires.toISOString(),
    });
    return { success: true };
  },

  /**
   * Immediate cancellation: since no payment was collected, there is no paid
   * period to run out — the business goes back to the free tier right away.
   * UI copy must say access ends immediately. Goes through the owner-validated
   * RPC, with a direct-update fallback while the migration is not applied.
   */
  async cancelSubscription(businessId: string): Promise<{ success: boolean }> {
    const { error } = await (supabase as any).rpc('cancel_premium_simulation', {
      p_business_id: businessId,
    });
    if (!error) return { success: true };
    if (!isMissingDbFunction(error)) throw error;

    // TODO: remove fallback once 2026103xx migrations are applied
    await businessesService.updateBusiness(businessId, {
      subscription_tier: 'free',
      subscription_expires_at: null,
    });
    return { success: true };
  },

  /**
   * SAMPLE DATA ONLY — view/share tracking does not exist in the schema yet.
   * TODO(schema): add an event_views/event_analytics table, then replace this
   * with real queries. Callers must label this output as sample data.
   */
  async getSampleEventAnalytics(eventId: string, days = 30) {
    const dailyData = Array.from({ length: days }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      const baseViews = Math.floor(Math.random() * 50) + 10;
      return {
        date: date.toISOString().split('T')[0],
        views: baseViews,
        saves: Math.floor(baseViews * Math.random() * 0.2),
        rsvps: Math.floor(baseViews * Math.random() * 0.1),
      };
    });
    const totals = dailyData.reduce(
      (acc, d) => ({
        views: acc.views + d.views,
        saves: acc.saves + d.saves,
        rsvps: acc.rsvps + d.rsvps,
      }),
      { views: 0, saves: 0, rsvps: 0 }
    );
    return {
      totalViews: totals.views,
      uniqueViews: Math.floor(totals.views * 0.7),
      totalSaves: totals.saves,
      totalRsvps: totals.rsvps,
      mapClicks: Math.floor(totals.views * 0.3),
      shareClicks: Math.floor(totals.views * 0.05),
      dailyData,
    };
  },
};
