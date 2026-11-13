/**
 * Pure mapping from collection rows to .ics inputs (Phase F "Add upcoming to
 * calendar"). No service imports, so it is unit-testable under node.
 */
import { buildRecurrenceRule, getEventWebUrl, type IcsEventInput } from '@/utils/eventIcs';
import { exceptionsForIcs, type OccurrenceException } from '@/utils/occurrences';
import type { CollectionEvent } from '@/types/database';

export function toIcsInputs(events: readonly CollectionEvent[], exceptionsByEvent: ReadonlyMap<string, readonly OccurrenceException[]>): IcsEventInput[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    startIso: e.start_datetime,
    endIso: e.end_datetime,
    address: e.address,
    timezone: e.timezone,
    recurrence: e.is_recurring && e.recurrence_pattern ? buildRecurrenceRule(e.recurrence_pattern, true, e.timezone, e.start_datetime) : null,
    exceptions: e.is_recurring ? exceptionsForIcs(e, exceptionsByEvent.get(e.id) ?? []) : undefined,
    description: [e.description?.trim(), `${getEventWebUrl(e.id)}\n\nHosted by ${e.business_name}`].filter(Boolean).join('\n\n'),
  }));
}

