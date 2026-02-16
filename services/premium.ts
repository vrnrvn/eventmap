// services/premium.ts

import { businessesService } from './businesses';

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
    id: string;
    business_id: string;
    plan_id: string;
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive';
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    plan?: PremiumPlan;
  }
  
  const MOCK_PLANS: PremiumPlan[] = [
    {
      id: 'plan-free',
      slug: 'free',
      name: 'Free',
      description: 'Get started with basic event posting',
      price_monthly: 0,
      price_yearly: 0,
      max_events: 2,
      max_photos_per_event: 1,
      boost_multiplier: 1.0,
      analytics_enabled: false,
      highlighted_markers: false,
      recurring_events: false,
      sort_order: 0,
      features: [
        'Up to 2 active events',
        '1 photo per event',
        'Basic map marker',
        'Standard placement',
      ],
    },
    {
      id: 'plan-starter',
      slug: 'starter',
      name: 'Starter',
      description: 'Great for small businesses',
      price_monthly: 999,
      price_yearly: 9990,
      max_events: 10,
      max_photos_per_event: 5,
      boost_multiplier: 1.5,
      analytics_enabled: true,
      highlighted_markers: false,
      recurring_events: true,
      sort_order: 1,
      features: [
        'Up to 10 active events',
        '5 photos per event',
        'Recurring events',
        'Event analytics',
        '1.5× boost placement',
      ],
    },
    {
      id: 'plan-pro',
      slug: 'pro',
      name: 'Pro',
      description: 'Full-featured for growing businesses',
      price_monthly: 2999,
      price_yearly: 29990,
      max_events: 50,
      max_photos_per_event: 15,
      boost_multiplier: 3.0,
      analytics_enabled: true,
      highlighted_markers: true,
      recurring_events: true,
      sort_order: 2,
      features: [
        'Up to 50 active events',
        '15 photos per event',
        'Recurring events',
        'Full analytics dashboard',
        'Highlighted map markers',
        '3× boost placement',
        'Priority support',
      ],
    },
    {
      id: 'plan-enterprise',
      slug: 'enterprise',
      name: 'Enterprise',
      description: 'Unlimited everything for large organizations',
      price_monthly: 7999,
      price_yearly: 79990,
      max_events: -1,
      max_photos_per_event: 50,
      boost_multiplier: 5.0,
      analytics_enabled: true,
      highlighted_markers: true,
      recurring_events: true,
      sort_order: 3,
      features: [
        'Unlimited events',
        '50 photos per event',
        'Recurring events',
        'Advanced analytics & export',
        'Highlighted map markers',
        '5× boost placement',
        'Dedicated support',
        'Custom branding',
      ],
    },
  ];
  
  // ── Mutable mock state ──
  let mockSubscription: BusinessSubscription | null = null;
  let mockEventCount = 0;
  
  // ══════════════════════════════════════════════════════════
  // TEST HELPERS — call these from a debug panel or console
  // ══════════════════════════════════════════════════════════
  export const premiumTestHelpers = {
    /** Simulate subscribing to a plan by slug */
    setMockPlan(slug: 'free' | 'starter' | 'pro' | 'enterprise') {
      if (slug === 'free') {
        mockSubscription = null;
        return;
      }
      const plan = MOCK_PLANS.find((p) => p.slug === slug);
      if (!plan) return;
      const now = new Date();
      const end = new Date(now);
      end.setMonth(end.getMonth() + 1);
      mockSubscription = {
        id: `sub-mock-${slug}`,
        business_id: 'mock-biz',
        plan_id: plan.id,
        status: 'active',
        current_period_start: now.toISOString(),
        current_period_end: end.toISOString(),
        cancel_at_period_end: false,
        plan,
      };
    },
  
    /** Simulate a certain number of existing events */
    setMockEventCount(count: number) {
      mockEventCount = count;
    },
  
    /** Reset to free tier */
    reset() {
      mockSubscription = null;
      mockEventCount = 0;
    },
  
    /** Get current mock state for debugging */
    getState() {
      return {
        subscription: mockSubscription,
        eventCount: mockEventCount,
        planSlug: mockSubscription?.plan?.slug ?? 'free',
      };
    },
  };
  
  export const premiumService = {
    async getPlans(): Promise<PremiumPlan[]> {
      await new Promise((r) => setTimeout(r, 300));
      return MOCK_PLANS;
    },
  
    async getSubscription(
      businessId: string
    ): Promise<BusinessSubscription | null> {
      await new Promise((r) => setTimeout(r, 200));
      return mockSubscription;
    },
  
    async getFeatureLimits(businessId: string): Promise<PremiumPlan> {
      const sub = await this.getSubscription(businessId);
      if (sub?.status === 'active' && sub.plan) {
        return sub.plan;
      }
      return MOCK_PLANS[0];
    },
  
    async getEventCount(businessId: string): Promise<number> {
      await new Promise((r) => setTimeout(r, 100));
      return mockEventCount;
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
  
    async subscribeToPlan(
      businessId: string,
      planSlug: string,
      _billingCycle: 'monthly' | 'yearly'
    ): Promise<{ success: boolean }> {
      await new Promise((r) => setTimeout(r, 1000));
      premiumTestHelpers.setMockPlan(
        planSlug as 'free' | 'starter' | 'pro' | 'enterprise'
      );
      const tier = planSlug === 'free' ? 'free' : 'premium';
      await businessesService.updateBusiness(businessId, { subscription_tier: tier });
      return { success: true };
    },
  
    async cancelSubscription(
      businessId: string
    ): Promise<{ success: boolean }> {
      await new Promise((r) => setTimeout(r, 500));
      if (mockSubscription) {
        mockSubscription = { ...mockSubscription, cancel_at_period_end: true };
      }
      await businessesService.updateBusiness(businessId, { subscription_tier: 'free' });
      return { success: true };
    },
  
    async getEventAnalytics(eventId: string, days = 30) {
      await new Promise((r) => setTimeout(r, 400));
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
  
    async getBusinessAnalyticsSummary(businessId: string) {
      await new Promise((r) => setTimeout(r, 400));
      return {
        totalEvents: 8,
        totalViews: 2450,
        totalSaves: 189,
        totalRsvps: 67,
        topEvents: [
          { id: 'evt-1', title: 'Summer Music Festival', views: 842 },
          { id: 'evt-2', title: 'Rooftop Yoga', views: 531 },
          { id: 'evt-3', title: 'Food Truck Friday', views: 420 },
        ],
      };
    },
  };