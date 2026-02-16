// contexts/PremiumContext.tsx

import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    ReactNode,
  } from 'react';
  import {
    premiumService,
    PremiumPlan,
    BusinessSubscription,
  } from '@/services/premium';
  import { useApp } from './AppContext';
  
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
    canUse: (feature: FeatureKey) => boolean;
    canCreateEvent: (currentCount: number) => boolean;
    refreshSubscription: () => Promise<void>;
  }
  
  const PremiumContext = createContext<PremiumContextType>({
    subscription: null,
    currentPlan: null,
    allPlans: [],
    loading: true,
    isPremium: false,
    tierSlug: 'free',
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
  
    const loadData = useCallback(async () => {
      try {
        setLoading(true);
        const plans = await premiumService.getPlans();
        setAllPlans(plans);
  
        if (userBusiness) {
          const sub = await premiumService.getSubscription(userBusiness.id);
          setSubscription(sub);
          const limits = await premiumService.getFeatureLimits(userBusiness.id);
          setCurrentPlan(limits);
        } else {
          setSubscription(null);
          setCurrentPlan(plans.find((p) => p.slug === 'free') ?? null);
        }
      } catch (err) {
        console.error('Failed to load premium data:', err);
      } finally {
        setLoading(false);
      }
    }, [userBusiness?.id]);
  
    useEffect(() => {
      loadData();
    }, [loadData]);
  
    const isPremium =
      subscription?.status === 'active' &&
      currentPlan != null &&
      currentPlan.slug !== 'free';
  
    const tierSlug = currentPlan?.slug ?? 'free';
  
    const canUse = useCallback(
      (feature: FeatureKey) => {
        if (!currentPlan) return false;
        return premiumService.canUseFeature(currentPlan, feature);
      },
      [currentPlan]
    );
  
    const canCreateEvent = useCallback(
      (currentCount: number) => {
        if (!currentPlan) return true;
        return premiumService.canCreateEvent(currentPlan, currentCount);
      },
      [currentPlan]
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
          canUse,
          canCreateEvent,
          refreshSubscription: loadData,
        }}
      >
        {children}
      </PremiumContext.Provider>
    );
  }
  
  export const usePremium = () => useContext(PremiumContext);