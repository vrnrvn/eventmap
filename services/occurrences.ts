/**
 * Per-date changes to recurring series (migration 20261109140000).
 *
 * Until that migration is applied the table and RPCs don't exist:
 * `listExceptions` then returns [] (series render as before) and the write
 * calls throw OccurrencesUnavailableError, which the UI turns into "not
 * available yet" instead of a raw error.
 */
import { supabase } from './supabase';
import { signalEventWrites } from '@/utils/eventDataVersion';
import type { DateRsvpOverride, OccurrenceException } from '@/utils/occurrences';

export type DateAttendee = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  is_private: boolean;
  joined_at: string | null;
  /** 'series' = going to the whole series; 'date' = this date only. */
  via: 'series' | 'date';
};

export class OccurrencesUnavailableError extends Error {
  constructor() {
    super('Changing single dates is not available on this server yet.');
    this.name = 'OccurrencesUnavailableError';
  }
}

const MISSING = new Set(['42P01', 'PGRST205', '42883', 'PGRST202']);
let unavailable = false;

export function isOccurrencesUnavailable(): boolean {
  return unavailable;
}

type Result = { status: string; date: string; notified: number; next?: string | null };

async function call(fn: string, args: Record<string, unknown>): Promise<Result> {
  if (unavailable) throw new OccurrencesUnavailableError();
  // Not in types/supabase.generated.ts until the migration is applied.
  const { data, error } = await (supabase.rpc as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>)(fn, args);
  if (error) {
    if (error.code && MISSING.has(error.code)) {
      unavailable = true;
      throw new OccurrencesUnavailableError();
    }
    throw error;
  }
  return data as Result;
}

/** Host-facing text for the RPCs' guard errors; null for anything else. */
export function occurrenceErrorMessage(error: unknown): string | null {
  if (error instanceof OccurrencesUnavailableError) return error.message;
  const msg = (error as { message?: unknown } | null)?.message;
  if (typeof msg !== 'string') return null;
  if (msg.startsWith('event_full')) return 'That date is full.';
  const m = msg.match(/^(invalid_occurrence|not_allowed|not_recurring|event_not_active|rsvp_closed):\s*(.*)$/);
  if (m) return m[2] ? m[2].charAt(0).toUpperCase() + m[2].slice(1) + '.' : 'That date can’t be changed.';
  if (msg === 'event_not_active') return 'This event is not active.';
  return null;
}

export const occurrencesService = {
  async listExceptions(eventId: string): Promise<OccurrenceException[]> {
    if (unavailable) return [];
    const { data, error } = await (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)(
      'event_occurrence_exceptions'
    )
      .select('event_id, occurrence_date, kind, new_start, new_end, note')
      .eq('event_id', eventId)
      .order('occurrence_date');
    if (error) {
      if (error.code && MISSING.has(error.code)) {
        unavailable = true;
        return [];
      }
      throw error;
    }
    return (data ?? []) as unknown as OccurrenceException[];
  },

  /** One query for many series (Calendar screen). */
  async listExceptionsForEvents(eventIds: readonly string[]): Promise<OccurrenceException[]> {
    if (unavailable || eventIds.length === 0) return [];
    const { data, error } = await (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)(
      'event_occurrence_exceptions'
    )
      .select('event_id, occurrence_date, kind, new_start, new_end, note')
      .in('event_id', [...eventIds].slice(0, 200));
    if (error) {
      if (error.code && MISSING.has(error.code)) {
        unavailable = true;
        return [];
      }
      throw error;
    }
    return (data ?? []) as unknown as OccurrenceException[];
  },

  /** The signed-in user's per-date overrides for a series (RLS: own rows). */
  async listMyDateRsvps(eventId: string, userId: string): Promise<DateRsvpOverride[]> {
    if (unavailable) return [];
    const { data, error } = await (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)(
      'rsvp_occurrences'
    )
      .select('occurrence_date, status')
      .eq('event_id', eventId)
      .eq('user_id', userId);
    if (error) {
      if (error.code && MISSING.has(error.code)) return [];
      throw error;
    }
    return (data ?? []) as unknown as DateRsvpOverride[];
  },

  /**
   * Host view: who is going on one date (series goers minus opt-outs plus
   * date-only goers). Throws OccurrencesUnavailableError pre-migration.
   */
  async getDateAttendeesPage(
    eventId: string,
    dateKey: string,
    opts: { limit?: number; offset?: number } = {}
  ): Promise<{ total: number; has_more: boolean; items: DateAttendee[] }> {
    const r = (await call('get_occurrence_attendees_page', {
      p_event_id: eventId,
      p_date: dateKey,
      p_limit: opts.limit ?? 30,
      p_offset: opts.offset ?? 0,
    })) as unknown as { total: number; has_more: boolean; items: DateAttendee[] };
    return { total: Number(r?.total ?? 0), has_more: !!r?.has_more, items: r?.items ?? [] };
  },

  /** Going / not going for one date; null clears the override. */
  async setDateRsvp(eventId: string, dateKey: string, status: 'going' | 'not_going' | null) {
    return call('set_occurrence_rsvp', { p_event_id: eventId, p_date: dateKey, p_status: status });
  },

  /** Per-date going and waitlist counts (≤ 60 dates); empty before the migration. */
  async getDateGoingCounts(
    eventId: string,
    dateKeys: readonly string[]
  ): Promise<{ going: Record<string, number>; waitlist: Record<string, number> }> {
    const empty = { going: {}, waitlist: {} };
    if (unavailable || dateKeys.length === 0) return empty;
    try {
      const rows = (await call('get_occurrence_going_counts', {
        p_event_id: eventId,
        p_dates: dateKeys.slice(0, 60),
      })) as unknown as { occurrence_date: string; going_count: number; waitlist_count?: number }[];
      const going: Record<string, number> = {};
      const waitlist: Record<string, number> = {};
      for (const r of rows ?? []) {
        const k = r.occurrence_date.slice(0, 10);
        going[k] = Number(r.going_count);
        waitlist[k] = Number(r.waitlist_count ?? 0);
      }
      return { going, waitlist };
    } catch (e) {
      if (e instanceof OccurrencesUnavailableError) return empty;
      throw e;
    }
  },

  /**
   * "This and following": end the series the day before `dateKey` and start
   * a new one there (same details). Resolves to the new event's id.
   */
  async splitSeriesFrom(eventId: string, dateKey: string): Promise<string> {
    return (await call('split_series_from', { p_event_id: eventId, p_date: dateKey })) as unknown as string;
  },

  async skipOccurrence(eventId: string, dateKey: string, opts: { note?: string; notify?: boolean } = {}) {
    return call('skip_occurrence', {
      p_event_id: eventId,
      p_date: dateKey,
      p_note: opts.note ?? null,
      p_notify: opts.notify ?? true,
    });
  },

  async rescheduleOccurrence(
    eventId: string,
    dateKey: string,
    newStart: Date,
    newEnd: Date,
    opts: { note?: string; notify?: boolean } = {}
  ) {
    return call('reschedule_occurrence', {
      p_event_id: eventId,
      p_date: dateKey,
      p_new_start: newStart.toISOString(),
      p_new_end: newEnd.toISOString(),
      p_note: opts.note ?? null,
      p_notify: opts.notify ?? true,
    });
  },

  async restoreOccurrence(eventId: string, dateKey: string, opts: { notify?: boolean } = {}) {
    return call('restore_occurrence', { p_event_id: eventId, p_date: dateKey, p_notify: opts.notify ?? true });
  },
};

signalEventWrites(occurrencesService, ['skipOccurrence', 'rescheduleOccurrence', 'restoreOccurrence', 'setDateRsvp', 'splitSeriesFrom']);
