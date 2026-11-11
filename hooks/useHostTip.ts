import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { nextHostTip, type HostTipFacts, type HostTipId } from '@/utils/hostTips';
import { markTipSeen, readSeenTips } from '@/utils/hostTipsStore';

/**
 * Picks the one-time tip to show for the current situation and remembers
 * dismissals (HOST_ONBOARDING_PLAN.md §4 Stage 5).
 *
 * The tip is chosen once the facts settle and then held: it does not vanish
 * because a count changed under the host while they were reading it.
 */
export function useHostTip(facts: HostTipFacts, enabled = true): {
  tip: HostTipId | null;
  dismiss: () => void;
} {
  const { userBusiness } = useApp();
  const businessId = userBusiness?.id;
  const [seen, setSeen] = useState<HostTipId[] | null>(null);
  const [tip, setTip] = useState<HostTipId | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void readSeenTips(businessId).then((v) => {
      if (!cancelled) setSeen(v);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  // `facts` is a fresh object each render, so depend on its values.
  const factsKey = JSON.stringify(facts);
  useEffect(() => {
    if (!enabled || !businessId || seen === null) return;
    // Already showing one: leave it alone until it is dismissed.
    setTip((current) => current ?? nextHostTip(JSON.parse(factsKey) as HostTipFacts, seen));
  }, [enabled, businessId, seen, factsKey]);

  const dismiss = useCallback(() => {
    if (!tip) return;
    const dismissed = tip;
    setTip(null);
    setSeen((s) => (s && !s.includes(dismissed) ? [...s, dismissed] : s));
    if (businessId) void markTipSeen(businessId, dismissed);
  }, [tip, businessId]);

  return { tip: enabled ? tip : null, dismiss };
}
