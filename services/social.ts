import { supabase } from './supabase';
import {
  RsvpStatus,
  Rsvp,
  Save,
  Follow,
  RankedEvent,
  PublicAttendee,
  AttendeesPage,
} from '@/types/database';

export type GoingEventsScope = 'upcoming' | 'past' | 'interested';

export type AttendanceCounts = {
  upcoming: number;
  attended: number;
  /** Owner-only; 0 for other viewers. */
  saved: number;
  /** Owner-only; 0 for other viewers. */
  interested: number;
};

export const socialService = {
  async createOrUpdateRsvp(
    eventId: string,
    status: RsvpStatus
  ): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase.from('rsvps').upsert(
      {
        user_id: user.id,
        event_id: eventId,
        status,
      },
      {
        onConflict: 'user_id,event_id',
      }
    );

    if (error) throw error;
  },

  async deleteRsvp(eventId: string): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('rsvps')
      .delete()
      .eq('user_id', user.id)
      .eq('event_id', eventId);

    if (error) throw error;
  },

  async getUserRsvp(eventId: string): Promise<RsvpStatus | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
      p_search: opts?.search?.trim() ? opts.search.trim() : null,
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
    };
    return {
      upcoming: Number(raw.upcoming_count ?? 0),
      attended: Number(raw.attended_count ?? 0),
      saved: Number(raw.saved_count ?? 0),
      interested: Number(raw.interested_count ?? 0),
    };
  },

  async getUserRsvps(): Promise<Rsvp[]> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase.from('saves').insert({
      user_id: user.id,
      event_id: eventId,
    });

    if (error) throw error;
  },

  async unsaveEvent(eventId: string): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('saves')
      .delete()
      .eq('user_id', user.id)
      .eq('event_id', eventId);

    if (error) throw error;
  },

  async isEventSaved(eventId: string): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase.from('follows').insert({
      user_id: user.id,
      business_id: businessId,
    });

    if (error) throw error;
  },

  async unfollowBusiness(businessId: string): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('user_id', user.id)
      .eq('business_id', businessId);

    if (error) throw error;
  },

  async isFollowingBusiness(businessId: string): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('follows')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },
};
