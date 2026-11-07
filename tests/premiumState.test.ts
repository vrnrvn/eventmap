import { describe, it, expect } from 'vitest';
import { derivePremiumState } from '../utils/premiumState';
import type { Business } from '../types/database';

/** Premium status derived from the businesses row (perf review P1). */

const biz = (over: Partial<Business> = {}): Business =>
  ({
    id: 'b1',
    owner_id: 'u1',
    name: 'Biz',
    subscription_tier: 'free',
    subscription_expires_at: null,
    events_created_this_month: 0,
    last_reset_date: null,
    ...over,
  }) as Business;

const NOW = new Date('2026-11-06T12:00:00Z');

describe('derivePremiumState', () => {
  it('no business → free with zero events', () => {
    expect(derivePremiumState(null, NOW)).toEqual({
      subscription: null,
      planSlug: 'free',
      eventCount: 0,
      lapsed: false,
    });
  });

  it('free tier → free, never lapsed, even with a stale expiry', () => {
    const s = derivePremiumState(biz({ subscription_expires_at: '2020-01-01T00:00:00Z' }), NOW);
    expect(s.planSlug).toBe('free');
    expect(s.subscription).toBeNull();
    expect(s.lapsed).toBe(false);
  });

  it('active premium → pro subscription with the expiry as period end', () => {
    const s = derivePremiumState(
      biz({ subscription_tier: 'premium', subscription_expires_at: '2026-12-01T00:00:00Z' }),
      NOW
    );
    expect(s.planSlug).toBe('pro');
    expect(s.lapsed).toBe(false);
    expect(s.subscription).toEqual({
      business_id: 'b1',
      plan_slug: 'pro',
      status: 'active',
      current_period_end: '2026-12-01T00:00:00Z',
    });
  });

  it('premium with no expiry set → active (no expiry means no lapse)', () => {
    const s = derivePremiumState(biz({ subscription_tier: 'premium' }), NOW);
    expect(s.planSlug).toBe('pro');
    expect(s.lapsed).toBe(false);
  });

  it('expired premium → derived as free AND flagged lapsed for the downgrade write', () => {
    const s = derivePremiumState(
      biz({ subscription_tier: 'premium', subscription_expires_at: '2026-11-06T11:59:59Z' }),
      NOW
    );
    expect(s.planSlug).toBe('free');
    expect(s.subscription).toBeNull();
    expect(s.lapsed).toBe(true);
  });

  it('event count passes through within the month, resets across months', () => {
    expect(
      derivePremiumState(biz({ events_created_this_month: 7, last_reset_date: '2026-11-02' }), NOW)
        .eventCount
    ).toBe(7);
    expect(
      derivePremiumState(biz({ events_created_this_month: 7, last_reset_date: '2026-10-28' }), NOW)
        .eventCount
    ).toBe(0);
    // Same month a year earlier also resets.
    expect(
      derivePremiumState(biz({ events_created_this_month: 7, last_reset_date: '2025-11-02' }), NOW)
        .eventCount
    ).toBe(0);
  });
});
