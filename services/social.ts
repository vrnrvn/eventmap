import { supabase, getSessionUser } from './supabase';
import { RsvpError, classifyRsvpError } from '@/utils/rsvpErrors';
import {
  RsvpStatus,
  Rsvp,
  Save,
  Follow,
  RankedEvent,
  PublicAttendee,
  AttendeesPage,
  Business,
} from '@/types/database';

/**
 * Global user blocking depends on the user_blocks table added by migration
 * 20261030111000. Until it is applied, Postgres returns 42P01
 * (undefined_table) — surfaced as this typed NOT_AVAILABLE error so the UI
 * can degrade gracefully.
 */
export class BlockingUnavailableError extends Error {
  readonly code = 'NOT_AVAILABLE' as const;

  constructor() {
    super("Blocking isn't available on this server yet.");
    this.name = 'BlockingUnavailableError';
  }
}

function throwBlockError(error: { code?: string }): never {
  if (error.code === '42P01') throw new BlockingUnavailableError();
  throw error;
}

/** 'requested' (pending host approval) needs 20261104120000; gate on AttendanceCounts.requested. */
export type GoingEventsScope = 'upcoming' | 'past' | 'interested' | 'requested';

/**
 * RPCs shipped in prepared-but-unapplied migrations aren't in the generated
 * types yet. The screens only call these when get_event_details advertises
 * the feature, so a missing function is never reached in practice.
 */
const untypedRpc = (fn: string, args: Record<string, unknown>) =>
  (
    supabase.rpc as unknown as (
      f: string,
      a: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(fn, args);

export type AttendanceCounts = {
  upcoming: number;
  attended: number;
  /** Owner-only; 0 for other viewers. */
  saved: number;
  /** Owner-only; 0 for other viewers. */
  interested: number;
  /**
   * Owner-only pending approval requests; null when the backend predates
   * 20261104120000 (the 'requested' scope isn't available then).
   */
  requested: number | null;
};

export const socialService = {
  async createOrUpdateRsvp(
    eventId: string,
    status: RsvpStatus
  ): Promise<RsvpStatus | 'requested'> {
    const user = await getSessionUser();
    if (!user) throw new RsvpError('NOT_AUTHENTICATED');

    // Capacity-aware join (20261030108000): the RPC locks the event row and
    // enforces ban / cancelled / ended / capacity server-side. Every failure
    // is surfaced as a typed RsvpError so screens can show specific copy.
    // With 20261103170000 it returns the resulting status: under approval
    // mode a "going" tap lands as 'requested' (void before that = assume
    // the asked-for status).
    const { data, error } = await supabase.rpc('join_event_with_capacity', {
      p_event_id: eventId,
      p_status: status,
    });
    if (error) throw new RsvpError(classifyRsvpError(error), error);
    const result = data as unknown;
    return result === 'requested' || result === 'going' || result === 'interested'
      ? result
      : status;
  },

  /** Join the waitlist of a full event; resolves to the 1-based position. */
  async joinWaitlist(eventId: string): Promise<number> {
    const { data, error } = await untypedRpc('join_event_waitlist', { p_event_id: eventId });
    if (error) throw new RsvpError(classifyRsvpError(error), error);
    return typeof data === 'number' ? data : 0;
  },

  async leaveWaitlist(eventId: string): Promise<void> {
    const { error } = await untypedRpc('leave_event_waitlist', { p_event_id: eventId });
    if (error) throw error;
  },

  async deleteRsvp(eventId: string): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('rsvps')
      .delete()
      .eq('user_id', user.id)
      .eq('event_id', eventId);

    if (error) throw error;
  },

  async getUserRsvp(eventId: string): Promise<RsvpStatus | null> {
    const user = await getSessionUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('rsvps')
      .select('status')
      .eq('user_id', user.id)
      .eq('event_id', eventId)
      .maybeSingle();

    if (error) throw error;
    return data?.status === 'going' || data?.status === 'interested' ? data.status : null;
  },

  /** One page of going attendees (named first, then anonymous), with optional name search. */
  async getEventAttendeesPage(
    eventId: string,
    opts?: { limit?: number; offset?: number; search?: string | null }
  ): Promise<AttendeesPage> {
    const { data, error } = await supabase.rpc('get_event_attendees_page', {
      event_uuid: eventId,
      p_limit: opts?.limit ?? 30,
      p_offset: opts?.offset ?? 0,
      p_search: opts?.search?.trim() ? opts.search.trim() : undefined,
    });

    if (error) throw error;
    const raw = (data ?? {}) as Partial<AttendeesPage>;
    return {
      total: Number(raw.total ?? 0),
      items: (raw.items as PublicAttendee[]) ?? [],
      has_more: !!raw.has_more,
    };
  },

  async getEventAttendees(eventId: string): Promise<PublicAttendee[]> {
    const { data, error } = await supabase.rpc('get_event_attendees_public', {
      event_uuid: eventId,
    });

    if (error) throw error;
    return (data as PublicAttendee[]) || [];
  },

  /**
   * Events the user RSVP'd "going" to, split by whether the event is over
   * (end time for one-off events, recurrence end date for recurring ones).
   * Privacy is enforced server-side: other users only get the upcoming list
   * of profiles that share it, and never the history.
   */
  async getUserGoingEvents(
    userId: string,
    scope: GoingEventsScope,
    opts?: { limit?: number; offset?: number }
  ): Promise<RankedEvent[]> {
    const { data, error } = await supabase.rpc('get_user_going_events', {
      user_id_param: userId,
      p_scope: scope,
      p_limit: opts?.limit ?? 20,
      p_offset: opts?.offset ?? 0,
    });

    if (error) throw error;
    const raw = (data as any[]) || [];
    return raw.map((e) => ({
      ...e,
      distance_km: 0,
      is_premium: false,
    })) as RankedEvent[];
  },

  async getUserUpcomingEvents(
    userId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<RankedEvent[]> {
    return this.getUserGoingEvents(userId, 'upcoming', opts);
  },

  async getUserPastEvents(
    userId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<RankedEvent[]> {
    return this.getUserGoingEvents(userId, 'past', opts);
  },

  /** Upcoming and attended counts for a profile header. Attended is owner-only. */
  async getUserAttendanceCounts(userId: string): Promise<AttendanceCounts> {
    const { data, error } = await supabase.rpc('get_user_attendance_counts', {
      user_id_param: userId,
    });

    if (error) throw error;
    const raw = (data ?? {}) as {
      upcoming_count?: number;
      attended_count?: number;
      saved_count?: number;
      interested_count?: number;
      requested_count?: number;
    };
    return {
      upcoming: Number(raw.upcoming_count ?? 0),
      attended: Number(raw.attended_count ?? 0),
      saved: Number(raw.saved_count ?? 0),
      interested: Number(raw.interested_count ?? 0),
      requested: raw.requested_count === undefined ? null : Number(raw.requested_count),
    };
  },

  async getUserRsvps(): Promise<Rsvp[]> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('rsvps')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).filter((rsvp): rsvp is typeof rsvp & { status: RsvpStatus } =>
      rsvp.status === 'going' || rsvp.status === 'interested');
  },

  async saveEvent(eventId: string): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase.from('saves').insert({
      user_id: user.id,
      event_id: eventId,
    });

    // Unique violation: a retry after an earlier insert landed but its
    // response was lost. The row exists, which is what the caller wanted.
    if (error && error.code !== '23505') throw error;
  },

  async unsaveEvent(eventId: string): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('saves')
      .delete()
      .eq('user_id', user.id)
      .eq('event_id', eventId);

    if (error) throw error;
  },

  async isEventSaved(eventId: string): Promise<boolean> {
    const user = await getSessionUser();
    if (!user) return false;

    const { data, error } = await supabase
      .from('saves')
      .select('id')
      .eq('user_id', user.id)
      .eq('event_id', eventId)
      .maybeSingle();

    if (error) throw error;
    return !!data;
  },

  async getUserSavedEvents(): Promise<Save[]> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('saves')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /** The caller's saved events in one round trip, upcoming first then past. */
  async getUserSavedEventsWithDetails(opts?: {
    limit?: number;
    offset?: number;
  }): Promise<RankedEvent[]> {
    const { data, error } = await supabase.rpc('get_user_saved_events', {
      p_limit: opts?.limit ?? 50,
      p_offset: opts?.offset ?? 0,
    });

    if (error) throw error;
    const raw = (data as any[]) || [];
    return raw.map((e) => ({
      ...e,
      distance_km: 0,
      is_premium: false,
    })) as RankedEvent[];
  },

  async followBusiness(businessId: string): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase.from('follows').insert({
      user_id: user.id,
      business_id: businessId,
    });

    // Unique violation: a retry after an earlier insert landed but its
    // response was lost. The row exists, which is what the caller wanted.
    if (error && error.code !== '23505') throw error;
  },

  async unfollowBusiness(businessId: string): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('user_id', user.id)
      .eq('business_id', businessId);

    if (error) throw error;
  },

  async isFollowingBusiness(businessId: string): Promise<boolean> {
    const user = await getSessionUser();
    if (!user) return false;

    const { data, error } = await supabase
      .from('follows')
      .select('id')
      .eq('user_id', user.id)
      .eq('business_id', businessId)
      .maybeSingle();

    if (error) throw error;
    return !!data;
  },

  async getUserFollows(): Promise<Follow[]> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('follows')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /** Batched lookup for follow lists — one query instead of one per business. */
  async getBusinessesByIds(businessIds: string[]): Promise<Business[]> {
    const unique = Array.from(new Set(businessIds));
    if (unique.length === 0) return [];

    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .in('id', unique);

    if (error) throw error;
    return (data as Business[]) || [];
  },

  /**
   * Follower counts for many businesses in one round trip: a single follows
   * select filtered by business_id, aggregated client-side. Every requested
   * id is present in the result (0 when it has no followers).
   */
  async getFollowerCountsByBusinessIds(
    businessIds: string[]
  ): Promise<Record<string, number>> {
    const unique = Array.from(new Set(businessIds));
    const counts: Record<string, number> = {};
    for (const id of unique) counts[id] = 0;
    if (unique.length === 0) return counts;

    const { data, error } = await supabase
      .from('follows')
      .select('business_id')
      .in('business_id', unique);

    if (error) throw error;
    for (const row of data || []) {
      counts[row.business_id] = (counts[row.business_id] ?? 0) + 1;
    }
    return counts;
  },

  /**
   * Block a user globally. Storage only for now — content-level enforcement
   * (hiding blocked users' chat/events) is a server-side follow-up.
   * Throws BlockingUnavailableError until migration 20261030111000 is applied.
   */
  async blockUser(blockedUserId: string): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    // Not in the generated types until migration 20261030111000 is applied.
    const { error } = await (supabase as any).from('user_blocks').insert({
      blocker_id: user.id,
      blocked_id: blockedUserId,
    });

    if (error) {
      // Unique violation: already blocked — treat as success (idempotent).
      if (error.code === '23505') return;
      throwBlockError(error);
    }
  },

  /** Remove a global block. Throws BlockingUnavailableError pre-apply. */
  async unblockUser(blockedUserId: string): Promise<void> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await (supabase as any)
      .from('user_blocks')
      .delete()
      .eq('blocker_id', user.id)
      .eq('blocked_id', blockedUserId);

    if (error) throwBlockError(error);
  },

  /**
   * Everyone the current user has blocked, newest first, with display names.
   * Throws BlockingUnavailableError pre-apply.
   */
  async getBlockedUsers(): Promise<{ id: string; name: string; avatar_url: string | null }[]> {
    const user = await getSessionUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('user_blocks')
      .select('blocked_id, created_at')
      .eq('blocker_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throwBlockError(error);
    const ids = (data ?? []).map((row) => row.blocked_id);
    if (ids.length === 0) return [];

    // With 20261103120000 applied, get_profiles_display returns "First L."
    // and no avatar for private accounts (full name before that).
    const { data: profiles, error: profileError } = await supabase.rpc('get_profiles_display', {
      user_ids: ids,
    });
    if (profileError) throw profileError;

    type DisplayProfile = { id: string; name: string | null; avatar_url: string | null };
    const byId = new Map(
      ((profiles as unknown as DisplayProfile[]) ?? []).map((p) => [p.id, p])
    );
    return ids.map((id) => {
      const profile = byId.get(id);
      return {
        id,
        name: profile?.name?.trim() || 'EventMap user',
        avatar_url: profile?.avatar_url ?? null,
      };
    });
  },

  /**
   * Whether the current user has blocked the given user.
   * Throws BlockingUnavailableError pre-apply (callers may treat as false).
   */
  async isBlocked(blockedUserId: string): Promise<boolean> {
    const user = await getSessionUser();
    if (!user) return false;

    const { data, error } = await (supabase as any)
      .from('user_blocks')
      .select('blocked_id')
      .eq('blocker_id', user.id)
      .eq('blocked_id', blockedUserId)
      .maybeSingle();

    if (error) throwBlockError(error);
    return !!data;
  },
};
