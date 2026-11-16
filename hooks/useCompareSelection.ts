import { useCallback, useSyncExternalStore } from 'react';
import { router } from 'expo-router';
import type { RankedEvent } from '@/types/database';
import { compareStore, canCompare, compareAnnouncement, type AddResult } from '@/stores/compareStore';
import { fromRankedEvent } from '@/utils/compare';
import { announce } from '@/utils/accessibility';
import { notify } from '@/utils/notify';
import { selectionHaptic } from '@/utils/haptics';

/**
 * The compare tray's selection and mode, for the list screens and the tray
 * itself (docs/EVENT_COMPARISON_PLAN.md §3.1). One place owns the side
 * effects of a selection change — haptic, spoken announcement, the refusal
 * toast at the cap — so every entry point behaves the same.
 */
export function useCompareSelection() {
  const items = useSyncExternalStore(compareStore.subscribe, compareStore.getSnapshot, compareStore.getSnapshot);
  const active = useSyncExternalStore(compareStore.subscribe, compareStore.isActive, compareStore.isActive);

  const toggle = useCallback((event: RankedEvent, nextIso?: string): AddResult => {
    const entry = fromRankedEvent(event, nextIso);
    const wasSelected = compareStore.isSelected(entry.id);
    const result = compareStore.toggle(entry);
    selectionHaptic();
    if (!result.ok) {
      // Refused, not evicted: the user chose those four (plan §3.1).
      const message = compareAnnouncement('full', entry.title, result.count);
      notify.error(message);
      announce(message);
      return result;
    }
    announce(compareAnnouncement(wasSelected ? 'removed' : 'added', entry.title, result.count));
    return result;
  }, []);

  const remove = useCallback((id: string) => {
    const entry = compareStore.getSnapshot().find((e) => e.id === id);
    if (!entry) return;
    compareStore.remove(id);
    selectionHaptic();
    announce(compareAnnouncement('removed', entry.title, compareStore.count()));
  }, []);

  const setActive = useCallback((next: boolean) => compareStore.setActive(next), []);
  const exit = useCallback(() => compareStore.exit(), []);
  const openComparison = useCallback(() => {
    if (!canCompare(compareStore.count())) return;
    router.push('/compare' as never);
  }, []);

  return {
    items,
    active,
    count: items.length,
    canCompare: canCompare(items.length),
    isSelected: (id: string) => items.some((e) => e.id === id),
    toggle,
    remove,
    setActive,
    exit,
    openComparison,
  };
}
