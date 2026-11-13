/**
 * "Add upcoming to calendar" for a collection (docs/EVENT_COLLECTIONS_PLAN.md
 * Phase F): one .ics with every upcoming member — series with their RRULE
 * and exceptions — through the same share / download path as the event
 * page's .ics button. Online-only (it reads the full upcoming list).
 */
import { useCallback, useState } from 'react';
import { collectionsService } from '@/services/collections';
import { occurrencesService } from '@/services/occurrences';
import type { OccurrenceException } from '@/utils/occurrences';
import { toIcsInputs } from '@/utils/collectionIcs';
import { shareCalendarIcs } from '@/utils/eventShare';
import { collectionErrorMessage } from '@/utils/collections';
import { notify } from '@/utils/notify';
import { blockedOffline } from '@/utils/requireOnline';
import type { Collection } from '@/types/database';

const MAX_EVENTS = 100;

export function useCollectionCalendarExport() {
  const [busy, setBusy] = useState(false);
  const exportUpcoming = useCallback(async (collection: Collection) => {
    if (busy || blockedOffline('Exporting a collection')) return;
    setBusy(true);
    try {
      const events = await collectionsService.events(collection.id, { filter: 'upcoming', limit: MAX_EVENTS, offset: 0 });
      if (events.length === 0) {
        notify.success('Nothing upcoming to add yet.');
        return;
      }
      const seriesIds = events.filter((e) => e.is_recurring).map((e) => e.id);
      const exceptions = seriesIds.length > 0 ? await occurrencesService.listExceptionsForEvents(seriesIds) : [];
      const byEvent = new Map<string, OccurrenceException[]>();
      for (const x of exceptions) byEvent.set(x.event_id, [...(byEvent.get(x.event_id) ?? []), x]);
      await shareCalendarIcs(toIcsInputs(events, byEvent), collection.name);
      notify.success(`${events.length} ${events.length === 1 ? 'event' : 'events'} ready for your calendar.`);
    } catch (err) {
      notify.error(collectionErrorMessage(err) ?? "Couldn't create the calendar file.");
    } finally {
      setBusy(false);
    }
  }, [busy]);
  return { exportUpcoming, busy };
}
