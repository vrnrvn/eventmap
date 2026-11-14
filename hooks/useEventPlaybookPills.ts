import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import {
  buildEventPlaybook,
  playbookPillLabel,
  resolvePlaybookState,
  type PlaybookEvent,
} from '@/utils/eventPlaybook';
import { EMPTY_PLAYBOOK_LOCAL, readPlaybookLocalMany, type EventPlaybookLocal } from '@/utils/eventPlaybookStore';
import { effectiveHostType } from '@/utils/hostSetup';
import { eventPlaybookService, type PlaybookServerState } from '@/services/eventPlaybook';

/**
 * "2 to do" labels for a list of the host's own events
 * (docs/HOST_EVENT_PLAYBOOK_PLAN.md P4).
 *
 * Only what the event row already says: no per-event *facts* are fetched for
 * a list, so items whose state is unknown stay hidden and the count is a
 * floor, never an inflated one. Dismissing a stage in the hub also silences
 * its pill here.
 *
 * Ticks come from the device store and, once migration 20261113100000 is
 * applied, from the server in one batched read (P5) so a tick made on
 * another device is reflected here too.
 *
 * `nextStartById` supplies the next occurrence for a series, so a weekly
 * event's pill follows its next date like the hub card does.
 */
export function useEventPlaybookPills(
  events: readonly (PlaybookEvent & { id: string })[],
  nextStartById?: ReadonlyMap<string, string>
): Map<string, string | null> {
  const { userBusiness } = useApp();
  const [local, setLocal] = useState<Map<string, EventPlaybookLocal>>(new Map());
  /** null = backend without the checklist table; one batched read per list. */
  const [server, setServer] = useState<Map<string, PlaybookServerState> | null>(null);

  const ids = useMemo(() => events.map((e) => e.id).filter(Boolean), [events]);
  const idKey = ids.join(',');

  useEffect(() => {
    if (ids.length === 0) {
      setLocal(new Map());
      setServer(null);
      return;
    }
    let cancelled = false;
    void readPlaybookLocalMany(ids).then((m) => {
      if (!cancelled) setLocal(m);
    });
    // Best-effort: without it the device copy stands on its own.
    void eventPlaybookService
      .getMany(ids)
      .catch(() => null)
      .then((m) => {
        if (!cancelled) setServer(m);
      });
    return () => {
      cancelled = true;
    };
    // `idKey` stands in for `ids`, which is a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  return useMemo(() => {
    const out = new Map<string, string | null>();
    if (!userBusiness) return out;
    const hostType = effectiveHostType(userBusiness);
    for (const event of events) {
      const id = event.id;
      const stored = local.get(id) ?? EMPTY_PLAYBOOK_LOCAL;
      const state = resolvePlaybookState(
        { ticked: stored.ticked, dismissedStages: stored.dismissedStages },
        server ? (server.get(id) ?? { ticked: [], dismissedStages: [] }) : null
      );
      const playbook = buildEventPlaybook({
        event: { ...event, next_start_datetime: nextStartById?.get(id) ?? event.next_start_datetime },
        hostType,
        local: {
          shared: stored.shared,
          notifiedFollowers: stored.notifiedFollowers,
          openedInsights: stored.openedInsights,
          duplicated: stored.duplicated,
        },
        manual: state.ticked,
      });
      // A stage the host dismissed in the hub stays quiet in the list too.
      out.set(id, state.dismissedStages.includes(playbook.stage) ? null : playbookPillLabel(playbook));
    }
    return out;
  }, [events, local, server, userBusiness, nextStartById]);
}
