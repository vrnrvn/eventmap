/**
 * Plan B picks for one moment on one event (docs/PLAN_B_PLAN.md §4.1).
 * Disabled unless the page's state calls for it — a normal event page makes
 * no Plan B request at all. Keyed by the moment and its session, so the
 * cancelled-event, cancelled-date, full and "late" answers never mix.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { planBService } from '@/services/planB';
import type { PlanBAnchor } from '@/utils/planB';

export function usePlanB(anchor: PlanBAnchor | null, enabled: boolean) {
  const { profile } = useAuth();
  const prefs = profile?.preferred_categories ?? null;
  return useQuery({
    queryKey: [
      'planB',
      anchor?.eventId ?? 'none',
      anchor?.reason ?? 'none',
      anchor?.dateKey ?? '',
      anchor?.start.toISOString() ?? '',
      // The late anchor moves with the viewer; round so GPS jitter doesn't refetch.
      anchor ? `${anchor.lat.toFixed(2)},${anchor.lng.toFixed(2)}` : '',
      (prefs ?? []).join(','),
    ],
    enabled: enabled && !!anchor,
    staleTime: 2 * 60 * 1000,
    queryFn: () => planBService.getPicks(anchor!, { preferredCategoryIds: prefs }),
  });
}
