// contexts/PremiumContext.tsx

import { createContext, useContext, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { premiumService, PremiumPlan, BusinessSubscription } from '@/services/premium';
import { useApp } from './AppContext';
import { useAuth } from './AuthContext';
import { derivePremiumState } from '@/utils/premiumState';
import { getConnectivity } from '@/utils/connectivity';

type FeatureKey =
  | 'analytics'
  | 'highlighted_markers'
  | 'recurring_events'
  | 'multi_photos';

interface PremiumContextType {
  subscription: BusinessSubscription | null;
  currentPlan: PremiumPlan | null;
  allPlans: PremiumPlan[];
  loading: boolean;
  isPremium: boolean;
  tierSlug: string;
  eventCount: number;
  eventLimit: number;
  canUse: (feature: FeatureKey) => boolean;
  canCreateEvent: (currentCount?: number) => boolean;
  refreshSubscription: () => Promise<void>;
}

const PremiumContext = createContext<PremiumContextType>({
  subscription: null,
  currentPlan: null,
  allPlans: [],
  loading: true,
  isPremium: false,
  tierSlug: 'free',
  eventCount: 0,
  eventLimit: 2,
  canUse: () => false,
  canCreateEvent: () => true,
  refreshSubscription: async () => {},
});

/**
 * Premium status, derived from the `businesses` row AppContext already holds
 * (see utils/premiumState.ts). No fetching of its own: previously this
 * provider re-fetched that same row three times on every startup, retry and
 * reconnect, serialized behind the auth and business loads. AppContext owns
 * loading, offline snapshots, verified-session gating and reconnect retries
 * for the row; this provider inherits all of that for free.
 */
export function PremiumProvider({ children }: { children: ReactNode }) {
  const { userBusiness, loading: appLoading, refreshBusiness } = useApp();
  const { sessionStale } = useAuth();

  const allPlans = premiumService.getPlans();
  const derived = useMemo(() => derivePremiumState(userBusiness), [userBusiness]);
  const currentPlan = useMemo(
    () => premiumService.getPlanBySlug(derived.planSlug) ?? null,
    [derived.planSlug]
  );

  // A lapsed simulated subscription needs a one-off downgrade write so
  // server-side gating (recurring trigger, event limit) agrees with the UI,
  // which already derives it as free. Guarded per business + expiry so a
  // re-render or retry can't send it twice (the old load path could race two
  // cancels), and re-armed if a later row shows premium again.
  const downgradedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!derived.lapsed || !userBusiness) return;
    // Only with a verified session: an unverified (anonymous) write matches
    // no rows yet reports success, which would mark this done for the session.
    if (sessionStale || getConnectivity() === 'offline') return;
    const key = `${userBusiness.id}:${userBusiness.subscription_expires_at ?? ''}`;
    if (downgradedForRef.current === key) return;
    downgradedForRef.current = key;
    premiumService
      .cancelSubscription(userBusiness.id)
      .then(() => refreshBusiness())
      .catch((err) => {
        console.error('Failed to downgrade lapsed subscription:', err);
        // Allow another attempt on the next business refresh.
        downgradedForRef.current = null;
      });
  }, [derived.lapsed, userBusiness, refreshBusiness, sessionStale]);

  const canUse = useCallback(
    (feature: FeatureKey) => {
      if (!currentPlan) return false;
      return premiumService.canUseFeature(currentPlan, feature);
    },
    [currentPlan]
  );

  const eventCount = derived.eventCount;
  const canCreateEvent = useCallback(
    (currentCount = eventCount) => {
      if (!currentPlan) return true;
      return premiumService.canCreateEvent(currentPlan, currentCount);
    },
    [currentPlan, eventCount]
  );

  const value = useMemo<PremiumContextType>(
    () => ({
      subscription: derived.subscription,
      currentPlan,
      allPlans,
      loading: appLoading,
      isPremium: derived.subscription !== null,
      tierSlug: derived.planSlug,
      eventCount,
      eventLimit: currentPlan?.max_events ?? 2,
      canUse,
      canCreateEvent,
      // The subscription IS the business row; refreshing one refreshes both.
      refreshSubscription: refreshBusiness,
    }),
    [derived, currentPlan, allPlans, appLoading, eventCount, canUse, canCreateEvent, refreshBusiness]
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export const usePremium = () => useContext(PremiumContext);
