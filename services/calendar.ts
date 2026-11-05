/**
 * Personal calendar data (docs/ANALYTICS_AND_CALENDAR_PLAN.md §2.4).
 *
 * Phase B: `get_user_calendar` (prepared migration 20261104110000, NOT applied
 * to the shared DB) returns every series the caller is going to, has asked to
 * join, is interested in, saved or hosts that can occur in a date range, with
 * the event zone and lifecycle status. While the function is missing the
 * hook falls back to the Phase A lists (see hooks/useCalendarEvents.ts);
 * `CalendarRpcUnavailableError` is the signal, and the first miss is
 * remembered for the session so later mounts skip the probe.
 */
import { supabase } from './supabase';
import { isMissingDbFunction } from './hostTools';
import type { CalendarSource, SourcedEvent } from '@/utils/calendar';
import { fromRpcRows, toRpcSources, type CalendarRpcRow } from '@/utils/calendarRpc';

export type { CalendarRpcRow };

export class CalendarRpcUnavailableError extends Error {
  constructor() {
    super('get_user_calendar is not available on this backend');
    this.name = 'CalendarRpcUnavailableError';
  }
}

export type CalendarRange = { rows: SourcedEvent<CalendarRpcRow>[]; truncated: boolean };

let rpcUnavailable = false;

/** Whether an earlier call already found the RPC missing in this session. */
export function isCalendarRpcKnownUnavailable(): boolean {
  return rpcUnavailable;
}

/** The prepared RPC isn't in the generated types yet. */
const untypedRpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => ReturnType<typeof supabase.rpc>)(fn, args);

export const calendarService = {
  async getUserCalendar(from: Date, to: Date, sources: readonly CalendarSource[]): Promise<CalendarRange> {
    if (rpcUnavailable) throw new CalendarRpcUnavailableError();
    const { data, error } = await untypedRpc('get_user_calendar', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_sources: toRpcSources(sources),
    });
    if (error) {
      if (isMissingDbFunction(error)) {
        rpcUnavailable = true;
        throw new CalendarRpcUnavailableError();
      }
      throw error;
    }
    const raw = (data ?? {}) as { rows?: CalendarRpcRow[]; truncated?: boolean };
    return { rows: fromRpcRows(raw.rows ?? [], sources), truncated: !!raw.truncated };
  },
};
