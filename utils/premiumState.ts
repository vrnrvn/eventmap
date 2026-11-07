import type { Business } from '@/types/database';

/**
 * Pure derivation of a business's premium state from its `businesses` row —
 * the single source of truth (services/premium.ts header). Everything the
 * premium UI needs is on that one row (`subscription_tier`,
 * `subscription_expires_at`, `events_created_this_month`, `last_reset_date`),
 * so deriving instead of fetching lets PremiumContext reuse the row
 * AppContext already loaded: previously premium startup issued three extra
 * requests that each re-fetched this same row.
 *
 * Mirrors the server rules: check_event_creation_limit gates on
 * subscription_tier = 'premium' (free = 2 events/month, premium = 30), and a
 * lapsed simulated subscription simply has subscription_expires_at in the
 * past. `lapsed` is reported so the caller can trigger the one-off downgrade
 * write (premiumService.cancelSubscription) that keeps server-side gating in
 * agreement — the derived values already treat the business as free.
 */

export type SubscriptionLike = {
  business_id: string;
  plan_slug: string;
  status: 'active';
  current_period_end: string | null;
};

export type PremiumState = {
  /** Null when free or lapsed (same as premiumService.getSubscription). */
  subscription: SubscriptionLike | null;
  /** 'free' | 'pro' — index into the client plan catalog. */
  planSlug: 'free' | 'pro';
  /** Events created this month, zeroed when last_reset_date is a past month. */
  eventCount: number;
  /** Tier says premium but the expiry passed; needs the downgrade write. */
  lapsed: boolean;
};

export function derivePremiumState(business: Business | null, now = new Date()): PremiumState {
  if (!business) return { subscription: null, planSlug: 'free', eventCount: 0, lapsed: false };

  const expiresAt = business.subscription_expires_at;
  const expired = !!expiresAt && new Date(expiresAt).getTime() <= now.getTime();
  const premium = business.subscription_tier === 'premium' && !expired;
  const lapsed = business.subscription_tier === 'premium' && expired;

  // Same month-rollover rule as businessesService.checkEventLimit: the
  // server resets the counter lazily, so a stale counter from a previous
  // month counts as 0. Compared in UTC: last_reset_date is a Postgres `date`
  // set from the server's UTC CURRENT_DATE, and `new Date('YYYY-MM-DD')` is
  // UTC midnight. Comparing with LOCAL months made users west of UTC read a
  // reset on the 1st as last month, showing 0 events used all month.
  let eventCount = business.events_created_this_month ?? 0;
  if (business.last_reset_date && !sameUtcMonth(new Date(business.last_reset_date), now)) {
    eventCount = 0;
  }

  return {
    subscription: premium
      ? {
          business_id: business.id,
          plan_slug: 'pro',
          status: 'active',
          current_period_end: expiresAt ?? null,
        }
      : null,
    planSlug: premium ? 'pro' : 'free',
    eventCount,
    lapsed,
  };
}

/** Same calendar month in UTC (an invalid date never matches). */
export function sameUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
}
