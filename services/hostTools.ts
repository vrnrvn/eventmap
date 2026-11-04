/**
 * Host-side tooling for the "Manage event" hub.
 *
 * Every call here degrades gracefully while the prepared migration
 * `20261103100000_host_event_tools.sql` is NOT applied (another dev session
 * owns the shared DB): the richer host RPCs are tried first and, when Postgres
 * reports the function as missing, the public RPCs stand in with a reduced
 * result. `source` on each result tells the UI which path was used so it can
 * hide controls that need the real thing.
 */
import { supabase } from './supabase';
import { socialService } from './social';
import { eventsService } from './events';
import type { EventDetails, RsvpMode, RsvpStatus, WaitlistMode } from '@/types/database';

type RpcError = { code?: string; message?: string } | null;

/** 42883 = undefined_function, PGRST202 = not in PostgREST schema cache. */
export function isMissingDbFunction(error: RpcError): boolean {
  return !!error && (error.code === '42883' || error.code === 'PGRST202');
}

/** The prepared RPCs aren't in the generated types yet. */
const untypedRpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => ReturnType<typeof supabase.rpc>)(
    fn,
    args
  );

/**
 * Raised by the `guard_event_capacity_shrink` trigger when a plain UPDATE
 * would lower the cap below the current going count (`capacity_below_going`).
 */
export function isCapacityBelowAttendanceError(error: unknown): boolean {
  const e = (error ?? {}) as { message?: unknown; details?: unknown; hint?: unknown };
  return [e.message, e.details, e.hint]
    .filter((v): v is string => typeof v === 'string')
    .some((v) => v.toLowerCase().includes('capacity_below'));
}

export type HostEventCounts = { going: number; interested: number; waitlist: number | null };

/** Raised by `d_guard_event_time_changes` when a plain update moves a booked event. */
export function isRescheduleRequiredError(error: unknown): boolean {
  const e = (error ?? {}) as { message?: unknown; details?: unknown };
  return [e.message, e.details]
    .filter((v): v is string => typeof v === 'string')
    .some((v) => v.toLowerCase().includes('reschedule_required'));
}

export class HostToolsUnavailableError extends Error {
  readonly code = 'NOT_AVAILABLE' as const;
  constructor(feature: string) {
    super(`${feature} needs a database update that has not been applied yet.`);
    this.name = 'HostToolsUnavailableError';
  }
}

export type HostOverview = {
  going: number;
  /** null when the host RPC is missing (RLS hides other users' rsvps). */
  interested: number | null;
  /** null when neither RPC exposes it. */
  waitlist: number | null;
  /** Users the host removed and banned from rejoining; null pre-20261103110000. */
  removed: number | null;
  /** Pending join requests (approval mode); null pre-20261103170000. */
  requested: number | null;
  saves: number;
  views_total: number | null;
  views_7d: number | null;
  /** Announcements sent in the last 24h (limit 3); null pre-20261103130000. */
  announcements_today: number | null;
  chat: {
    locked: boolean;
    slow_mode_seconds: number;
    message_count: number | null;
    blocked_count: number | null;
    open_reports: number | null;
  } | null;
  source: 'host_rpc' | 'details_fallback';
};

export type HostAttendeeStatus = RsvpStatus | 'requested' | 'waitlist' | 'removed';

export type HostAttendee = {
  /** Real profile id when `can_manage`; otherwise an opaque anonymous key. */
  user_id: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
  status: HostAttendeeStatus;
  joined_at: string | null;
  /** Host's reason, for `removed` rows only. */
  reason: string | null;
  chat_blocked: boolean;
  /** False for anonymised rows from the public fallback RPC. */
  can_manage: boolean;
};

export type HostAttendeesPage = {
  total: number;
  items: HostAttendee[];
  has_more: boolean;
  source: 'host_rpc' | 'public_fallback';
};

function overviewFromDetails(details: EventDetails): HostOverview {
  return {
    going: details.rsvp_count ?? 0,
    interested: null,
    waitlist: details.waitlist ? details.waitlist.count : null,
    removed: null,
    requested: null,
    saves: details.save_count ?? 0,
    views_total: null,
    views_7d: null,
    announcements_today: null,
    chat: null,
    source: 'details_fallback',
  };
}

export const hostToolsService = {
  /**
   * Counts for the Overview tab. Falls back to `get_event_details`, which
   * only knows going + saves (+ waitlist count once 20261102160000 is live).
   */
  async getOverview(eventId: string, details?: EventDetails | null): Promise<HostOverview> {
    const { data, error } = await untypedRpc('get_event_host_overview', { p_event_id: eventId });
    if (!error && data) {
      const raw = data as Omit<HostOverview, 'source'>;
      return {
        going: Number(raw.going ?? 0),
        interested: Number(raw.interested ?? 0),
        waitlist: Number(raw.waitlist ?? 0),
        removed: raw.removed === undefined || raw.removed === null ? null : Number(raw.removed),
        requested:
          raw.requested === undefined || raw.requested === null ? null : Number(raw.requested),
        saves: Number(raw.saves ?? 0),
        views_total: Number(raw.views_total ?? 0),
        views_7d: Number(raw.views_7d ?? 0),
        announcements_today:
          raw.announcements_today === undefined || raw.announcements_today === null
            ? null
            : Number(raw.announcements_today),
        chat: raw.chat
          ? {
              locked: !!raw.chat.locked,
              slow_mode_seconds: Number(raw.chat.slow_mode_seconds ?? 0),
              message_count: Number(raw.chat.message_count ?? 0),
              blocked_count: Number(raw.chat.blocked_count ?? 0),
              open_reports: Number(raw.chat.open_reports ?? 0),
            }
          : null,
        source: 'host_rpc',
      };
    }
    if (error && !isMissingDbFunction(error)) throw error;

    const d = details ?? (await eventsService.getEventDetails(eventId));
    if (!d) throw new Error('Event not found');
    return overviewFromDetails(d);
  },

  /**
   * One page of attendees for the host. The fallback can only list `going`
   * rows and anonymises private profiles, so `interested` / `waitlist`
   * requests return an empty page with `source: 'public_fallback'`.
   */
  async getAttendeesPage(
    eventId: string,
    opts: { status?: HostAttendeeStatus; limit?: number; offset?: number; search?: string | null } = {}
  ): Promise<HostAttendeesPage> {
    const status = opts.status ?? 'going';
    const limit = opts.limit ?? 30;
    const offset = opts.offset ?? 0;
    const search = opts.search?.trim() ? opts.search.trim() : undefined;

    const { data, error } = await untypedRpc('get_event_host_attendees_page', {
      p_event_id: eventId,
      p_status: status,
      p_limit: limit,
      p_offset: offset,
      p_search: search,
    });
    if (!error && data) {
      const raw = data as { total?: number; items?: Partial<HostAttendee>[]; has_more?: boolean };
      return {
        total: Number(raw.total ?? 0),
        has_more: !!raw.has_more,
        source: 'host_rpc',
        items: (raw.items ?? []).map((row) => ({
          user_id: String(row.user_id),
          name: row.name ?? 'Attendee',
          avatar_url: row.avatar_url ?? null,
          bio: row.bio ?? null,
          is_private: !!row.is_private,
          status: (row.status as HostAttendeeStatus) ?? status,
          joined_at: row.joined_at ?? null,
          reason: row.reason ?? null,
          chat_blocked: !!row.chat_blocked,
          can_manage: true,
        })),
      };
    }
    if (error && !isMissingDbFunction(error)) throw error;

    if (status !== 'going') {
      return { total: 0, items: [], has_more: false, source: 'public_fallback' };
    }
    const page = await socialService.getEventAttendeesPage(eventId, { limit, offset, search });
    return {
      total: page.total,
      has_more: page.has_more,
      source: 'public_fallback',
      items: page.items.map((row) => ({
        user_id: row.id,
        name: row.name,
        avatar_url: row.avatar_url,
        bio: row.bio,
        is_private: !!row.is_anonymous,
        status: 'going',
        joined_at: null,
        reason: null,
        chat_blocked: false,
        can_manage: !row.is_anonymous,
      })),
    };
  },

  /**
   * Drops the RSVP, blocks the user from the chat and notifies them
   * (`host_remove_attendee`, 20261102150000). With 20261103110000 applied the
   * removal also bans them from rejoining; before that the extra `p_ban`
   * argument makes PostgREST report the function as missing, so the call is
   * retried in the older 3-argument shape. Throws `HostToolsUnavailableError`
   * when neither exists.
   */
  async removeAttendee(eventId: string, userId: string, reason?: string | null): Promise<void> {
    const args = {
      p_event_id: eventId,
      p_user_id: userId,
      p_reason: reason?.trim() ? reason.trim() : null,
    };
    const first = await untypedRpc('host_remove_attendee', { ...args, p_ban: true });
    if (!first.error) return;
    if (!isMissingDbFunction(first.error)) throw first.error;
    const second = await untypedRpc('host_remove_attendee', args);
    if (!second.error) return;
    if (isMissingDbFunction(second.error)) throw new HostToolsUnavailableError('Removing attendees');
    throw second.error;
  },

  /**
   * Sets (or clears, with null) the going cap through `host_set_event_capacity`,
   * the explicit path that may lower the cap below current attendance; the
   * caller must have confirmed that with the host first. A plain UPDATE is
   * refused by the `guard_event_capacity_shrink` trigger in that case. Falls
   * back to a direct update while the RPC is missing.
   */
  async setCapacity(eventId: string, maxAttendees: number | null): Promise<void> {
    const { error } = await untypedRpc('host_set_event_capacity', {
      p_event_id: eventId,
      p_max_attendees: maxAttendees,
    });
    if (!error) return;
    if (!isMissingDbFunction(error)) throw error;
    await eventsService.updateEvent(eventId, { max_attendees: maxAttendees });
  },

  /**
   * going / interested / waitlist for several of the caller's events in one
   * call (My Events rows). Falls back to the public `event_rsvp_counts`
   * table (going + interested only) while the RPC is missing.
   */
  async getEventsCounts(eventIds: string[]): Promise<Map<string, HostEventCounts>> {
    const out = new Map<string, HostEventCounts>();
    if (eventIds.length === 0) return out;
    const { data, error } = await untypedRpc('get_host_events_counts', { p_event_ids: eventIds });
    if (!error) {
      for (const row of (data ?? []) as { event_id: string; going: number; interested: number; waitlist: number }[]) {
        out.set(row.event_id, {
          going: Number(row.going ?? 0),
          interested: Number(row.interested ?? 0),
          waitlist: Number(row.waitlist ?? 0),
        });
      }
      return out;
    }
    if (!isMissingDbFunction(error)) throw error;
    const fallback = await (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)(
      'event_rsvp_counts'
    )
      .select('event_id, going_count, interested_count')
      .in('event_id', eventIds);
    if (fallback.error) throw fallback.error;
    for (const row of (fallback.data ?? []) as unknown as {
      event_id: string;
      going_count: number;
      interested_count: number;
    }[]) {
      out.set(row.event_id, {
        going: Number(row.going_count ?? 0),
        interested: Number(row.interested_count ?? 0),
        waitlist: null,
      });
    }
    return out;
  },

  /**
   * "Accepting RSVPs" switch and waitlist mode (`host_set_event_settings`,
   * 20261103130000). Both columns are returned by get_event_details once the
   * migration is applied; before that this throws HostToolsUnavailableError.
   */
  async setEventSettings(
    eventId: string,
    settings: { rsvpClosed?: boolean; waitlistMode?: WaitlistMode; rsvpMode?: RsvpMode }
  ): Promise<{ rsvp_closed: boolean; waitlist_mode: WaitlistMode; rsvp_mode: RsvpMode }> {
    // 20261103170000 adds p_rsvp_mode; the 3-arg shape (20261103130000) is
    // retried without it when PostgREST reports the new one missing.
    const first = await untypedRpc('host_set_event_settings', {
      p_event_id: eventId,
      p_rsvp_closed: settings.rsvpClosed,
      p_waitlist_mode: settings.waitlistMode,
      p_rsvp_mode: settings.rsvpMode,
    });
    let data = first.data;
    if (first.error) {
      if (!isMissingDbFunction(first.error)) throw first.error;
      if (settings.rsvpMode !== undefined) throw new HostToolsUnavailableError('Approval mode');
      const second = await untypedRpc('host_set_event_settings', {
        p_event_id: eventId,
        p_rsvp_closed: settings.rsvpClosed,
        p_waitlist_mode: settings.waitlistMode,
      });
      if (second.error) {
        if (isMissingDbFunction(second.error)) throw new HostToolsUnavailableError('Event settings');
        throw second.error;
      }
      data = second.data;
    }
    const raw = (data ?? {}) as { rsvp_closed?: boolean; waitlist_mode?: WaitlistMode; rsvp_mode?: RsvpMode };
    return {
      rsvp_closed: !!raw.rsvp_closed,
      waitlist_mode: raw.waitlist_mode ?? 'notify',
      rsvp_mode: raw.rsvp_mode ?? 'open',
    };
  },

  /**
   * Approve or decline a pending join request (`host_review_rsvp`,
   * 20261103170000). Approval re-checks capacity server-side (`EVENT_FULL`).
   */
  async reviewRsvp(eventId: string, userId: string, decision: 'approve' | 'decline'): Promise<void> {
    const { error } = await untypedRpc('host_review_rsvp', {
      p_event_id: eventId,
      p_user_id: userId,
      p_decision: decision,
    });
    if (!error) return;
    if (isMissingDbFunction(error)) throw new HostToolsUnavailableError('Reviewing requests');
    throw error;
  },

  /**
   * In-app notification to attendees (`send_event_announcement`). The server
   * enforces 1–500 chars, 3 per event per day, and the recipients' preference.
   */
  async sendAnnouncement(
    eventId: string,
    body: string,
    audience: 'going' | 'all'
  ): Promise<{ recipients: number; sentToday: number }> {
    const { data, error } = await untypedRpc('send_event_announcement', {
      p_event_id: eventId,
      p_body: body.trim(),
      p_audience: audience,
    });
    if (error) {
      if (isMissingDbFunction(error)) throw new HostToolsUnavailableError('Announcements');
      throw error;
    }
    const raw = (data ?? {}) as { recipients?: number; sent_today?: number };
    return { recipients: Number(raw.recipients ?? 0), sentToday: Number(raw.sent_today ?? 0) };
  },

  /** Draft → published; checks the monthly allowance and notifies followers. */
  async publishEvent(eventId: string): Promise<{ notified: number }> {
    const { data, error } = await untypedRpc('publish_event', { p_event_id: eventId });
    if (error) {
      if (isMissingDbFunction(error)) throw new HostToolsUnavailableError('Publishing drafts');
      throw error;
    }
    const raw = (data ?? {}) as { notified?: number };
    return { notified: Number(raw.notified ?? 0) };
  },

  /** Pauses the event: RSVPs kept, joining closed, "new date coming" banner. */
  async postponeEvent(eventId: string, note?: string | null): Promise<{ notified: number }> {
    const { data, error } = await untypedRpc('postpone_event', {
      p_event_id: eventId,
      p_note: note?.trim() ? note.trim() : null,
    });
    if (error) {
      if (isMissingDbFunction(error)) throw new HostToolsUnavailableError('Postponing');
      throw error;
    }
    const raw = (data ?? {}) as { notified?: number };
    return { notified: Number(raw.notified ?? 0) };
  },

  /**
   * The only path to change time/place once anyone is going (the server
   * refuses plain updates with `reschedule_required`). Also resumes a postponed
   * event. Falls back to a plain update while the RPC is missing.
   */
  async rescheduleEvent(
    eventId: string,
    change: {
      startIso: string;
      endIso: string;
      note?: string | null;
      address?: string | null;
      lat?: number | null;
      lng?: number | null;
    }
  ): Promise<{ status: string; notified: number }> {
    const { data, error } = await untypedRpc('reschedule_event', {
      p_event_id: eventId,
      p_start_datetime: change.startIso,
      p_end_datetime: change.endIso,
      p_note: change.note?.trim() ? change.note.trim() : null,
      p_address: change.address ?? null,
      p_lat: change.lat ?? null,
      p_lng: change.lng ?? null,
    });
    if (!error) {
      const raw = (data ?? {}) as { status?: string; notified?: number };
      return { status: raw.status ?? 'active', notified: Number(raw.notified ?? 0) };
    }
    if (!isMissingDbFunction(error)) throw error;
    const updates: Record<string, unknown> = { start_datetime: change.startIso, end_datetime: change.endIso };
    if (change.address != null) {
      updates.address = change.address;
      updates.lat = change.lat;
      updates.lng = change.lng;
    }
    await eventsService.updateEvent(eventId, updates);
    return { status: 'active', notified: 0 };
  },

  /** Copies the event into a new draft and returns its id. */
  async duplicateEvent(eventId: string): Promise<string> {
    const { data, error } = await untypedRpc('duplicate_event', { p_event_id: eventId });
    if (error) {
      if (isMissingDbFunction(error)) throw new HostToolsUnavailableError('Duplicating events');
      throw error;
    }
    const id = typeof data === 'string' ? data : (data as { id?: string })?.id;
    if (!id) throw new Error('No copy was returned');
    return id;
  },

  /** Lifts an event ban and the chat block that came with the removal. */
  async unbanAttendee(eventId: string, userId: string): Promise<void> {
    const { error } = await untypedRpc('host_unban_attendee', {
      p_event_id: eventId,
      p_user_id: userId,
    });
    if (!error) return;
    if (isMissingDbFunction(error)) throw new HostToolsUnavailableError('Allowing attendees back');
    throw error;
  },

  /**
   * Moves a waitlisted user into "going". The server raises `EVENT_FULL` when
   * no seat is free and `not_on_waitlist` when they already left the line;
   * callers classify with `classifyRsvpError`.
   */
  async promoteFromWaitlist(eventId: string, userId: string): Promise<void> {
    const { error } = await untypedRpc('host_promote_from_waitlist', {
      p_event_id: eventId,
      p_user_id: userId,
    });
    if (!error) return;
    if (isMissingDbFunction(error)) throw new HostToolsUnavailableError('Promoting from the waitlist');
    throw error;
  },
};
