/**
 * "Run it again": duplicate an event into a draft the host dates themselves.
 *
 * The state lives here and each screen renders `RunItAgainSheet` itself, the
 * same split `useOccurrenceActions` + `MoveDateModal` already use.
 *
 * One call: `duplicate_event` v2 (20261118110000, applied) takes the chosen
 * start/end and the title, copies event_type and the chat set-up server-side,
 * and records `duplicated_from`. Before v2 this was the copy plus a follow-up
 * update and a best-effort chat/preset carry-over (see git history).
 *
 * Idempotency: a request key is minted when the sheet opens and reused for
 * every attempt from that opening, so a double tap or a retry after a lost
 * response returns the draft already made instead of a second one. A new
 * opening gets a new key.
 */
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { HostToolsUnavailableError, hostToolsService } from '@/services/hostTools';
import { markPlaybookSignal } from '@/utils/eventPlaybookStore';
import { notify } from '@/utils/notify';
import { blockedOffline } from '@/utils/requireOnline';
import { getDeviceTimeZone } from '@/utils/timezone';
import { uuidv4 } from '@/utils/uuid';
import { duplicateRefusalMessage } from '@/utils/duplicateDate';

/** What the sheet needs to offer a date, and the copy needs to look right. */
export type DuplicateSource = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  /** The event's own zone; the device's is used for legacy null zones. */
  zone: string;
  isRecurring?: boolean;
};

/** Builds a source from an event row, resolving the zone once. */
export function duplicateSourceFromEvent(event: {
  id: string;
  title: string;
  start_datetime: string;
  end_datetime: string;
  timezone?: string | null;
  is_recurring?: boolean;
}): DuplicateSource {
  return {
    id: event.id,
    title: event.title,
    start: new Date(event.start_datetime),
    end: new Date(event.end_datetime),
    zone: event.timezone || getDeviceTimeZone(),
    isRecurring: !!event.is_recurring,
  };
}

export function useDuplicateEvent() {
  const router = useRouter();
  const [source, setSource] = useState<DuplicateSource | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per sheet opening (see the header). A ref, not state: the
  // confirm handler must see the same key on every attempt.
  const requestKeyRef = useRef<string | null>(null);

  /** Opens the sheet, unless we're offline (the copy is a server write). */
  const start = useCallback((next: DuplicateSource) => {
    if (blockedOffline('duplicate this event')) return;
    requestKeyRef.current = uuidv4();
    setSource(next);
  }, []);

  const cancel = useCallback(() => {
    if (busy) return;
    requestKeyRef.current = null;
    setSource(null);
  }, [busy]);

  const confirm = useCallback(
    async (when: { start: Date; end: Date }) => {
      if (!source || busy) return;
      requestKeyRef.current ??= uuidv4();
      setBusy(true);
      try {
        const newId = await hostToolsService.duplicateEvent(source.id, {
          start: when.start,
          end: when.end,
          // "Run it again" means the same event again: the source's title,
          // not the server's " (copy)" default.
          title: source.title,
          requestKey: requestKeyRef.current,
        });
        markPlaybookSignal(source.id, 'duplicated');
        notify.success('Draft created. Check it over, then publish.');
        requestKeyRef.current = null;
        setSource(null);
        router.push(`/business/edit-event/${newId}` as never);
      } catch (err) {
        // The key is kept: retrying from this sheet is the same request.
        notify.error(err instanceof HostToolsUnavailableError ? err.message : duplicateRefusalMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [source, busy, router]
  );

  return { source, busy, start, cancel, confirm };
}
