// contexts/PremiumContext.tsx

import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useRef,
    ReactNode,
  } from 'react';
  import { AppState } from 'react-native';
  import {
    premiumService,
    PremiumPlan,
    BusinessSubscription,
  } from '@/services/premium';
  import { useApp } from './AppContext';
  import { useAuth } from './AuthContext';
  import { readPremiumSnapshot, writePremiumSnapshot } from '@/services/offlineSnapshots';
  import { getConnectivity, subscribeConnectivity } from '@/utils/connectivity';

  type PremiumSnapshot = {
    subscription: BusinessSubscription | null;
    currentPlan: PremiumPlan | null;
    eventCount: number;
  };

  const isPremiumSnapshot = (data: unknown): data is PremiumSnapshot =>
    typeof data === 'object' &&
    data !== null &&
    'subscription' in data &&
    'currentPlan' in data &&
    typeof (data as { eventCount?: unknown }).eventCount === 'number';
  
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
  
  export function PremiumProvider({ children }: { children: ReactNode }) {
    const { userBusiness } = useApp();
    const [subscription, setSubscription] =
      useState<BusinessSubscription | null>(null);
    const [currentPlan, setCurrentPlan] = useState<PremiumPlan | null>(null);
    const [allPlans, setAllPlans] = useState<PremiumPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [eventCount, setEventCount] = useState(0);
  
    const { sessionStale } = useAuth();
    // Guards against a slow load for a previous business applying late.
    const loadSeqRef = useRef(0);
    // The last network load failed or was skipped; retried on reconnect.
    const [premiumStale, setPremiumStale] = useState(false);
    const skippedForStaleRef = useRef(false);

    /**
     * A business's last known plan shows at once from the device snapshot,
     * so an offline start doesn't silently drop a premium host to free-tier
     * limits; the network result replaces it. Skipped while the session is
     * unverified, since an anonymous read finds no subscription
     * (docs/OFFLINE_PLAN.md §3.6).
     */
    const loadData = useCallback(async ({ useSnapshot = false } = {}) => {
      const seq = ++loadSeqRef.current;
      const businessId = userBusiness?.id;
      const plans = await premiumService.getPlans();
      if (seq !== loadSeqRef.current) return;
      setAllPlans(plans);

      if (!businessId) {
        setSubscription(null);
        setCurrentPlan(plans.find((p) => p.slug === 'free') ?? null);
        setEventCount(0);
        setPremiumStale(false);
        setLoading(false);
        return;
      }

      let haveSnapshot = false;
      if (useSnapshot) {
        const snapshot = await readPremiumSnapshot(businessId, isPremiumSnapshot);
        if (seq !== loadSeqRef.current) return;
        if (snapshot) {
          haveSnapshot = true;
          setSubscription(snapshot.data.subscription);
          setCurrentPlan(snapshot.data.currentPlan);
          setEventCount(snapshot.data.eventCount);
          setLoading(false);
        }
      }
      if (sessionStale) {
        skippedForStaleRef.current = true;
        setPremiumStale(true);
        setLoading(false);
        return;
      }

      try {
        if (!haveSnapshot) setLoading(true);
        const [sub, limits, count] = await Promise.all([
          premiumService.getSubscription(businessId),
          premiumService.getFeatureLimits(businessId),
          premiumService.getEventCount(businessId),
        ]);
        if (seq !== loadSeqRef.current) return;
        setSubscription(sub);
        setCurrentPlan(limits);
        setEventCount(count);
        setPremiumStale(false);
        writePremiumSnapshot(businessId, { subscription: sub, currentPlan: limits, eventCount: count });
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        // Keep what is shown (snapshot or an earlier load).
        console.error('Failed to load premium data:', err);
        setPremiumStale(true);
      } finally {
        if (seq === loadSeqRef.current) setLoading(false);
      }
    }, [userBusiness?.id, sessionStale]);

    useEffect(() => {
      loadData({ useSnapshot: true });
      // Reload only when the business changes; the effect below handles a
      // session that becomes verified.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userBusiness?.id]);

    useEffect(() => {
      if (!premiumStale || sessionStale || !userBusiness) return;
      if (skippedForStaleRef.current) {
        skippedForStaleRef.current = false;
        loadData();
      }
      let previous = getConnectivity();
      const unsubscribe = subscribeConnectivity((status) => {
        const wasOnline = previous === 'online';
        previous = status;
        if (status === 'online' && !wasOnline) loadData();
      });
      const appState = AppState.addEventListener('change', (state) => {
        if (state === 'active' && getConnectivity() !== 'offline') loadData();
      });
      return () => {
        unsubscribe();
        appState.remove();
      };
    }, [premiumStale, sessionStale, userBusiness, loadData]);

    const isPremium =
      subscription?.status === 'active' &&
      currentPlan != null &&
      currentPlan.slug !== 'free';
  
    const tierSlug = currentPlan?.slug ?? 'free';
    const eventLimit = currentPlan?.max_events ?? 2;

    const canUse = useCallback(
      (feature: FeatureKey) => {
        if (!currentPlan) return false;
        return premiumService.canUseFeature(currentPlan, feature);
      },
      [currentPlan]
    );

    const canCreateEvent = useCallback(
      (currentCount = eventCount) => {
        if (!currentPlan) return true;
        return premiumService.canCreateEvent(currentPlan, currentCount);
      },
      [currentPlan, eventCount]
    );

    return (
      <PremiumContext.Provider
        value={{
          subscription,
          currentPlan,
          allPlans,
          loading,
          isPremium,
          tierSlug,
          eventCount,
          eventLimit,
          canUse,
          canCreateEvent,
          refreshSubscription: () => loadData(),
        }}
      >
        {children}
      </PremiumContext.Provider>
    );
  }
  
  export const usePremium = () => useContext(PremiumContext);
