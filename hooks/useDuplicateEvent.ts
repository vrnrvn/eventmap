/**
 * "Run it again": duplicate an event into a draft the host dates themselves.
 *
 * The state lives here and each screen renders `RunItAgainSheet` itself, the
 * same split `useOccurrenceActions` + `MoveDateModal` already use.
 *
 * Against today's server this is two calls. `duplicate_event(p_event_id)`
 * takes no date, and the date it picks is wrong for a past event (it lands on
 * the current clock time, in UTC — see `utils/duplicateDate.ts`), so the
 * chosen start is written straight afterwards with a plain update. That is
 * allowed: the copy is a draft, and `guard_event_time_changes`
 * (20261103150000:395) returns early for any draft, so no `reschedule_event`
 * and no notification is involved. Nobody is going to a draft either, so
 * there is nothing to notify.
 *
 * Once the prepared v2 RPC is applied
 * (`supabase/prepared/2026-11-18_duplicate_v2/`) the second call collapses
 * into the first — see that folder's README for the cutover. The flow below
 * is deliberately written so that failing the second call still leaves the
 * host with a usable draft rather than nothing.
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { HostToolsUnavailableError, hostToolsService } from '@/services/hostTools';
import { eventsService } from '@/services/events';
import { carryOverToDuplicate } from '@/services/eventPresetSettings';
import { markPlaybookSignal } from '@/utils/eventPlaybookStore';
import { notify } from '@/utils/notify';
import { blockedOffline } from '@/utils/requireOnline';
import { getDeviceTimeZone } from '@/utils/timezone';
import type { ChatMode } from '@/services/eventChat';
import type { EventPresetId } from '@/utils/eventPresets';

/** What the sheet needs to offer a date, and the copy needs to look right. */
export type DuplicateSource = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  /** The event's own zone; the device's is used for legacy null zones. */
  zone: string;
  eventType?: EventPresetId | null;
  chatMode?: ChatMode | null;
  isRecurring?: boolean;
};

/** Builds a source from an event row, resolving the zone once. */
export function duplicateSourceFromEvent(
  event: {
    id: string;
    title: string;
    start_datetime: string;
    end_datetime: string;
    timezone?: string | null;
    event_type?: EventPresetId | null;
    is_recurring?: boolean;
  },
  chatMode?: ChatMode | null
): DuplicateSource {
  return {
    id: event.id,
    title: event.title,
    start: new Date(event.start_datetime),
    end: new Date(event.end_datetime),
    zone: event.timezone || getDeviceTimeZone(),
    eventType: event.event_type ?? null,
    chatMode: chatMode ?? null,
    isRecurring: !!event.is_recurring,
  };
}

export function useDuplicateEvent() {
  const router = useRouter();
  const [source, setSource] = useState<DuplicateSource | null>(null);
  const [busy, setBusy] = useState(false);

  /** Opens the sheet, unless we're offline (the copy is a server write). */
  const start = useCallback((next: DuplicateSource) => {
    if (blockedOffline('duplicate this event')) return;
    setSource(next);
  }, []);

  const cancel = useCallback(() => {
    if (!busy) setSource(null);
  }, [busy]);

  const confirm = useCallback(
    async (when: { start: Date; end: Date }) => {
      if (!source || busy) return;
      setBusy(true);
      try {
        const newId = await hostToolsService.duplicateEvent(source.id);
        markPlaybookSignal(source.id, 'duplicated');

        // The date the host actually chose, plus the source's title: the
        // server appends " (copy)", which is wrong for "run it again".
        let dated = true;
        try {
          await eventsService.updateEvent(newId, {
            start_datetime: when.start.toISOString(),
            end_datetime: when.end.toISOString(),
            title: source.title,
          });
        } catch {
          dated = false;
        }

        const carried = await carryOverToDuplicate(newId, {
          eventType: source.eventType ?? null,
          chatMode: source.chatMode ?? null,
        });

        notify.success(
          !dated
            ? "Draft created, but the date didn't save. Set it here before publishing."
            : carried
              ? 'Draft created. Check it over, then publish.'
              : 'Draft created. Set the chat option again in Manage event.'
        );
        setSource(null);
        router.push(`/business/edit-event/${newId}` as never);
      } catch (err) {
        notify.error(
          err instanceof HostToolsUnavailableError ? err.message : 'Could not duplicate. Please try again.'
        );
      } finally {
        setBusy(false);
      }
    },
    [source, busy, router]
  );

  return { source, busy, start, cancel, confirm };
}
