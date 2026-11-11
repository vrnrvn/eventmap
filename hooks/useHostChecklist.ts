import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '@/contexts/AppContext';
import { usePremium } from '@/contexts/PremiumContext';
import { hostChecklistService } from '@/services/hostChecklist';
import { queryKeys } from '@/hooks/queryKeys';
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus';
import {
  UNKNOWN_STATUS,
  buildHostChecklist,
  checklistVisibility,
  type ChecklistVisibility,
  type HostChecklist,
} from '@/utils/hostChecklist';
import {
  EMPTY_CHECKLIST_LOCAL,
  readChecklistLocal,
  updateChecklistLocal,
  type HostChecklistLocal,
} from '@/utils/hostChecklistStore';
import { effectiveHostType } from '@/utils/hostSetup';
import { pushEnabled } from '@/services/runtime';
import { hostTrustService } from '@/services/hostTrust';

/**
 * Getting-started checklist for the signed-in host (HOST_ONBOARDING_PLAN.md
 * §13). Joins the server facts with this device's signals and the premium
 * tier, and owns the card's visibility so both mount points stay one-liners.
 */
export function useHostChecklist(): {
  checklist: HostChecklist | null;
  visibility: ChecklistVisibility;
  /** Loaded at least once (server or fallback). */
  ready: boolean;
  dismiss: () => void;
} {
  const { userBusiness } = useApp();
  const { isPremium } = usePremium();
  const businessId = userBusiness?.id;

  const [local, setLocal] = useState<HostChecklistLocal>(EMPTY_CHECKLIST_LOCAL);
  const [localReady, setLocalReady] = useState(false);
  const [pushGranted, setPushGranted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void readChecklistLocal(businessId).then((v) => {
      if (cancelled) return;
      setLocal(v);
      setLocalReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  /**
   * Push permission is an OS fact, not app state. When the build has no push
   * support (web, or EXPO_PUBLIC_ENABLE_PUSH off) it stays null, so the
   * notifications item is hidden instead of being impossible to tick.
   */
  useEffect(() => {
    if (!pushEnabled) {
      setPushGranted(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const Notifications = await import('expo-notifications');
        const res = await Notifications.getPermissionsAsync();
        if (!cancelled) setPushGranted(res.status === 'granted');
      } catch {
        if (!cancelled) setPushGranted(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const statusQuery = useQuery({
    queryKey: queryKeys.hostChecklist(businessId),
    enabled: !!userBusiness,
    queryFn: () => hostChecklistService.getStatus(userBusiness!),
    staleTime: 60_000,
  });
  useRefetchOnFocus(statusQuery.refetch, !!userBusiness, queryKeys.hostChecklist(businessId));

  // Same key as Settings → Host profile, so a request sent there ticks this.
  const verificationQuery = useQuery({
    queryKey: ['host', 'verification', businessId ?? 'none'],
    enabled: !!userBusiness && !userBusiness.verified,
    queryFn: () => hostTrustService.getLatestRequest(userBusiness!.id),
    staleTime: 60_000,
  });
  const latest = verificationQuery.data;
  const verification: 'verified' | 'requested' | 'none' | null = userBusiness?.verified
    ? 'verified'
    : latest === undefined || latest === 'unavailable'
      ? null
      : latest && (latest.status === 'pending' || latest.status === 'approved')
        ? 'requested'
        : 'none';

  const checklist = userBusiness
    ? buildHostChecklist({
        hostType: effectiveHostType(userBusiness),
        status: statusQuery.data ?? UNKNOWN_STATUS,
        local: { sharedEvent: local.sharedEvent, openedManage: local.openedManage, pushGranted },
        premium: isPremium,
        verification,
      })
    : null;

  // Decided once per device: a host who already had published events when the
  // checklist first appeared starts collapsed rather than being told to
  // publish their first event.
  useEffect(() => {
    if (!businessId || !localReady || local.preexistingHost !== null) return;
    const published = statusQuery.data?.publishedEvents;
    if (published == null) return;
    void updateChecklistLocal(businessId, { preexistingHost: published > 0 }).then(setLocal);
  }, [businessId, localReady, local.preexistingHost, statusQuery.data?.publishedEvents]);

  const dismiss = useCallback(() => {
    if (!businessId) return;
    setLocal((l) => ({ ...l, dismissed: true }));
    void updateChecklistLocal(businessId, { dismissed: true });
  }, [businessId]);

  const ready = !!userBusiness && localReady && !statusQuery.isLoading;
  const visibility =
    checklist && ready
      ? checklistVisibility({
          checklist,
          dismissed: local.dismissed,
          // Until it is decided, treat the host as pre-existing: collapsed is
          // the quieter wrong answer for someone with a back catalogue.
          preexistingHost: local.preexistingHost ?? true,
        })
      : 'hidden';

  return { checklist, visibility, ready, dismiss };
}
