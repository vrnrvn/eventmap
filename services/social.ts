import { supabase } from './supabase';
import { RsvpStatus, Rsvp, Save, Follow, RankedEvent, PublicAttendee } from '@/types/database';
import { eventsService } from './events';

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
    return data?.status || null;
  },

  async getEventAttendees(eventId: string): Promise<PublicAttendee[]> {
    const { data, error } = await supabase.rpc('get_event_attendees_public', {
      event_uuid: eventId,
    });

    if (error) throw error;
    return (data as PublicAttendee[]) || [];
  },

  async getUserUpcomingEvents(userId: string): Promise<RankedEvent[]> {
    const { data, error } = await supabase.rpc('get_user_upcoming_events', {
      user_id_param: userId,
    });

    if (error) throw error;
    const raw = (data as any[]) || [];
    return raw.map((e) => ({
      ...e,
      distance_km: 0,
      is_premium: false,
    })) as RankedEvent[];
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
    return data || [];
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

  async getUserSavedEventsWithDetails(): Promise<RankedEvent[]> {
    const saves = await this.getUserSavedEvents();
    if (saves.length === 0) return [];

    const events: RankedEvent[] = [];
    for (const save of saves) {
      const details = await eventsService.getEventDetails(save.event_id);
      if (!details) continue;
      const { event, business, category, rsvp_count, save_count } = details;
      events.push({
        ...event,
        distance_km: 0,
        is_premium: false,
        rsvp_count,
        save_count,
        business_name: business.name,
        business_logo_url: business.logo_url,
        category_label: category.label,
        category_slug: category.slug,
      });
    }
    return events;
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
