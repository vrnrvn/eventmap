import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '@/contexts/AppContext';
import { hostChecklistService } from '@/services/hostChecklist';
import { queryKeys } from '@/hooks/queryKeys';
import {
  buildEventPlaybook,
  playbookVisibility,
  resolvePlaybookState,
  type EventPlaybook,
  type PlaybookEvent,
  type PlaybookFacts,
  type PlaybookItemId,
  type PlaybookVisibility,
} from '@/utils/eventPlaybook';
import {
  EMPTY_PLAYBOOK_LOCAL,
  dismissPlaybookStage,
  readPlaybookLocal,
  setPlaybookItemTicked,
  type EventPlaybookLocal,
} from '@/utils/eventPlaybookStore';
import { effectiveHostType } from '@/utils/hostSetup';
import { eventPlaybookService, type PlaybookServerState } from '@/services/eventPlaybook';

/**
 * Per-event checklist for the Manage hub (docs/HOST_EVENT_PLAYBOOK_PLAN.md
 * P2). Joins the event row and the hub's facts (passed in, so nothing is
 * fetched twice) with this device's ticks and signals, and owns the card's
 * visibility so the screen mounts it in one line.
 *
 * `enabled` must be the owner check: an admin looking at someone else's
 * event must not tick or dismiss that host's list.
 *
 * Ticks and dismissals are stored on the device and, once migration
 * 20261113100000 is applied, on the server too (P5) — the copy that follows
 * a host to a second device. Until then the server half simply reports
 * itself unavailable and the device copy is used, so nothing here waits on
 * the migration. Device-only signals (a share, opening insights) stay local
 * either way.
 *
 * `eventId: null` is the unsaved-form mode used by the publish preview: the
 * list still works, but ticks live in memory only. They are deliberately not
 * persisted under some shared "new event" key, which would carry a "no limit,
 * on purpose" tick onto the host's next event and show it as done when it
 * isn't.
 */
export function useEventPlaybook(input: {
  eventId: string | null | undefined;
  event: PlaybookEvent | null;
  facts: Partial<PlaybookFacts>;
  enabled: boolean;
}): {
  playbook: EventPlaybook | null;
  visibility: PlaybookVisibility;
  /** Local state loaded at least once. */
  ready: boolean;
  tick: (item: PlaybookItemId, done: boolean) => void;
  dismiss: () => void;
} {
  const { userBusiness } = useApp();
  const { eventId, event, facts, enabled } = input;

  const [local, setLocal] = useState<EventPlaybookLocal>(EMPTY_PLAYBOOK_LOCAL);
  const [localReady, setLocalReady] = useState(false);
  /** null = backend without the checklist table; undefined = not read yet. */
  const [server, setServer] = useState<PlaybookServerState | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    if (!eventId) {
      // Unsaved form: nothing to read, ticks stay in state.
      setLocalReady(true);
      return;
    }
    let cancelled = false;
    setLocalReady(false);
    setServer(undefined);
    void readPlaybookLocal(eventId).then((v) => {
      if (cancelled) return;
      setLocal(v);
      setLocalReady(true);
    });
    // Best-effort: a failed read leaves the device copy in charge.
    void eventPlaybookService
      .get(eventId)
      .catch(() => null)
      .then((v) => {
        if (!cancelled) setServer(v);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, enabled]);

  const serverRead = server !== undefined;
  const resolved = resolvePlaybookState(
    { ticked: local.ticked, dismissedStages: local.dismissedStages },
    serverRead ? server : null
  );

  /**
   * One-time hand-over: this host ticked things before the migration landed,
   * and the server row is empty. Push the device copy up rather than letting
   * an empty server row erase it.
   */
  const uploadFromLocal = resolved.uploadFromLocal;
  useEffect(() => {
    if (!eventId || !enabled || !serverRead || server === null || !uploadFromLocal) return;
    let cancelled = false;
    void (async () => {
      try {
        for (const item of local.ticked) {
          await eventPlaybookService.setItem(eventId, item, true);
        }
        let latest: PlaybookServerState | null = null;
        for (const stage of local.dismissedStages) {
          latest = await eventPlaybookService.dismissStage(eventId, stage);
        }
        if (!cancelled && latest) setServer(latest);
      } catch {
        // Keep using the device copy; the next open tries again.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per event once both copies are known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, enabled, serverRead, uploadFromLocal]);

  // Same key and fetch as the getting-started checklist, so the published
  // count is read once per host and the two cards never disagree.
  const statusQuery = useQuery({
    queryKey: queryKeys.hostChecklist(userBusiness?.id),
    enabled: enabled && !!userBusiness,
    queryFn: () => hostChecklistService.getStatus(userBusiness!),
    staleTime: 60_000,
  });

  const playbook =
    enabled && event && userBusiness
      ? buildEventPlaybook({
          event,
          hostType: effectiveHostType(userBusiness),
          facts,
          local: {
            shared: local.shared,
            notifiedFollowers: local.notifiedFollowers,
            openedInsights: local.openedInsights,
            duplicated: local.duplicated,
          },
          manual: resolved.ticked,
        })
      : null;

  const tick = useCallback(
    (item: PlaybookItemId, done: boolean) => {
      // Optimistic: the row flips at once, both stores catch up. The device
      // copy is always written, so it stays a usable fallback.
      setLocal((l) => ({
        ...l,
        ticked: done ? (l.ticked.includes(item) ? l.ticked : [...l.ticked, item]) : l.ticked.filter((id) => id !== item),
      }));
      setServer((s) =>
        s == null
          ? s
          : {
              ...s,
              ticked: done ? (s.ticked.includes(item) ? s.ticked : [...s.ticked, item]) : s.ticked.filter((id) => id !== item),
            }
      );
      if (!eventId) return;
      void setPlaybookItemTicked(eventId, item, done);
      void eventPlaybookService.setItem(eventId, item, done).catch(() => {
        // Local already has it; the server copy catches up on the next tick.
      });
    },
    [eventId]
  );

  const dismiss = useCallback(() => {
    if (!playbook || playbook.stage === 'none') return;
    const stage = playbook.stage;
    setLocal((l) => ({ ...l, dismissedStages: l.dismissedStages.includes(stage) ? l.dismissedStages : [...l.dismissedStages, stage] }));
    setServer((s) =>
      s == null || s.dismissedStages.includes(stage) ? s : { ...s, dismissedStages: [...s.dismissedStages, stage] }
    );
    if (!eventId) return;
    void dismissPlaybookStage(eventId, stage);
    void eventPlaybookService.dismissStage(eventId, stage).catch(() => {});
  }, [eventId, playbook]);

  const ready = localReady && !statusQuery.isLoading;
  const visibility =
    playbook && ready
      ? playbookVisibility({
          playbook,
          dismissedStages: resolved.dismissedStages,
          hostEventCount: statusQuery.data?.publishedEvents ?? null,
        })
      : 'hidden';

  return { playbook, visibility, ready, tick, dismiss };
}
