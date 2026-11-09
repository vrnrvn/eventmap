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
      'Event insights: views, saves and RSVPs',
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
      'Advanced analytics: trends, RSVP timing, audience',
      'Highlighted map markers',
      'Boosted placement',
      'Priority support',
    ],
  },
];

const FREE_PLAN = PLANS[0];
const PRO_PLAN = PLANS[1];

export const premiumService = {
  getPlans(): PremiumPlan[] {
    return PLANS;
  },

  getPlanBySlug(slug: string): PremiumPlan | undefined {
    return PLANS.find((p) => p.slug === slug);
  },

  // Live premium status, limits and event count are DERIVED from the
  // businesses row via utils/premiumState.ts (PremiumContext) — not fetched.
  // The old getSubscription/getFeatureLimits/getEventCount re-fetched that
  // row once each (plus AppContext's copy: 4 identical requests at startup)
  // and getSubscription hid a downgrade write; the derivation reports
  // `lapsed` instead and PremiumContext sends that write exactly once.

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

    // The only path to premium: owners can't write the tier directly
    // (trigger from 20261030101000), so there is no client fallback.
    const { error } = await supabase.rpc('activate_premium_simulation', {
      p_business_id: businessId,
      p_interval: billingCycle,
    });
    if (error) throw error;
    return { success: true };
  },

  /**
   * Immediate cancellation: since no payment was collected, there is no paid
   * period to run out — the business goes back to the free tier right away.
   * UI copy must say access ends immediately. Goes through the owner-validated
   * RPC (20261030101000).
   */
  async cancelSubscription(businessId: string): Promise<{ success: boolean }> {
    const { error } = await supabase.rpc('cancel_premium_simulation', {
      p_business_id: businessId,
    });
    if (error) throw error;
    return { success: true };
  },

};
