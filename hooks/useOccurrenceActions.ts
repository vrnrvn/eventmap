/**
 * Skip / move / restore one date of a recurring series, with the confirm →
 * "Tell attendees?" → RPC → toast flow. Lifted unchanged from
 * components/SeriesDatesSection.tsx so Manage event's "Upcoming dates" and the
 * host dashboard (docs/HOST_DASHBOARD_PLAN.md C5) run the same code.
 *
 * After any change it refreshes the series' exceptions and details (as the
 * component did) and the host dashboard, so the schedule reflects the change
 * wherever it was made.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queryKeys';
import { occurrenceErrorMessage, occurrencesService } from '@/services/occurrences';
import type { Occurrence } from '@/utils/occurrences';
import { confirmAction } from '@/utils/confirm';
import { notify } from '@/utils/notify';

/** "Thu 19 Nov, 7:00 pm" in the event zone (device zone for legacy events). */
export function formatOccurrenceWhen(d: Date, tz: string | null) {
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });
}

/** Confirm, then ask whether to notify. null = the host backed out. */
async function askNotify(title: string, message: string, confirmLabel: string): Promise<boolean | null> {
  const go = await confirmAction({ title, message, confirmLabel });
  if (!go) return null;
  return confirmAction({
    title: 'Tell attendees?',
    message: 'Send an in-app notice to people going, interested or who saved this event.',
    confirmLabel: 'Notify',
    cancelLabel: 'Don’t notify',
  });
}

/** The date being acted on: which series, its zone, and the occurrence. */
export type OccurrenceTarget = { eventId: string; tz: string | null; occurrence: Occurrence };

export function useOccurrenceActions() {
  const queryClient = useQueryClient();
  /** `${eventId}:${dateKey}` while its request is in flight. */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** The date whose move picker is open. */
  const [moving, setMoving] = useState<OccurrenceTarget | null>(null);

  const after = useCallback(
    async (eventId: string) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.occurrenceExceptions(eventId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.eventDetails(eventId) });
      // Every business's dashboard key shares this prefix; the host has one.
      void queryClient.invalidateQueries({ queryKey: ['events', 'host-dashboard'] });
    },
    [queryClient]
  );

  const run = useCallback(
    async (t: OccurrenceTarget, fn: () => Promise<{ notified: number }>, done: string) => {
      setBusyKey(`${t.eventId}:${t.occurrence.dateKey}`);
      try {
        const r = await fn();
        await after(t.eventId);
        notify.success(r.notified > 0 ? `${done} ${r.notified} ${r.notified === 1 ? 'person was' : 'people were'} notified.` : done);
      } catch (e) {
        notify.error(occurrenceErrorMessage(e) ?? 'Couldn’t change that date. Try again.');
      } finally {
        setBusyKey(null);
      }
    },
    [after]
  );

  const skip = useCallback(
    async (t: OccurrenceTarget) => {
      const when = formatOccurrenceWhen(t.occurrence.start, t.tz);
      const n = await askNotify('Skip this date?', `${when} won't happen. The rest of the series is unchanged.`, 'Skip date');
      if (n === null) return;
      await run(t, () => occurrencesService.skipOccurrence(t.eventId, t.occurrence.dateKey, { notify: n }), 'Date skipped.');
    },
    [run]
  );

  const restore = useCallback(
    async (t: OccurrenceTarget) => {
      const n = await askNotify(
        'Restore this date?',
        `${formatOccurrenceWhen(t.occurrence.originalStart, t.tz)} goes back to its original time.`,
        'Restore'
      );
      if (n === null) return;
      await run(t, () => occurrencesService.restoreOccurrence(t.eventId, t.occurrence.dateKey, { notify: n }), 'Date restored.');
    },
    [run]
  );

  /** Called by MoveDateModal's Save with the new start/end. */
  const saveMove = useCallback(
    async (t: OccurrenceTarget, start: Date, end: Date) => {
      setMoving(null);
      const n = await askNotify(
        'Move this date?',
        `${formatOccurrenceWhen(t.occurrence.originalStart, t.tz)} → ${formatOccurrenceWhen(start, t.tz)}`,
        'Move date'
      );
      if (n === null) return;
      await run(
        t,
        () => occurrencesService.rescheduleOccurrence(t.eventId, t.occurrence.dateKey, start, end, { notify: n }),
        'Date moved.'
      );
    },
    [run]
  );

  return { busyKey, setBusyKey, moving, startMove: setMoving, cancelMove: () => setMoving(null), skip, restore, saveMove, after };
}
