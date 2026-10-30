import { supabase } from './supabase';
import { RankedEvent, EventDetails, Event } from '@/types/database';
import { FilterOptions } from '@/types/app';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

export const eventsService = {
  async getRankedEvents(
    userLat: number,
    userLng: number,
    filters: Partial<FilterOptions> = {}
  ): Promise<RankedEvent[]> {
    const { data, error } = await supabase.rpc('get_ranked_events', {
      user_lat: userLat,
      user_lng: userLng,
      radius_km: filters.radiusKm || 50,
      category_ids: filters.categories?.length ? filters.categories : undefined,
      start_date: filters.startDate?.toISOString(),
      end_date: filters.endDate?.toISOString(),
      search_query: filters.searchQuery || undefined,
      result_limit: 100,
    });

    if (error) throw error;
    return (data || []) as RankedEvent[];
  },

  /**
   * Paged variant of getRankedEvents backed by the p_offset parameter added in
   * 20261030110000. While that migration is unapplied the 9-arg signature
   * doesn't exist (PostgREST reports PGRST202 / Postgres 42883 because params
   * are part of the signature), so this falls back to the legacy no-offset
   * call with the pre-pagination limit of 100 — identical to today's single
   * fetch — and reports hasMore=false so callers don't keep paging.
   */
  async getRankedEventsPage(
    userLat: number,
    userLng: number,
    filters: Partial<FilterOptions> = {},
    page: { limit: number; offset: number }
  ): Promise<{ items: RankedEvent[]; hasMore: boolean }> {
    const baseParams = {
      user_lat: userLat,
      user_lng: userLng,
      radius_km: filters.radiusKm || 50,
      category_ids: filters.categories?.length ? filters.categories : undefined,
      start_date: filters.startDate?.toISOString(),
      end_date: filters.endDate?.toISOString(),
      search_query: filters.searchQuery || undefined,
    };
    const { data, error } = await (supabase as any).rpc('get_ranked_events', {
      ...baseParams,
      result_limit: page.limit,
      p_offset: page.offset,
    });
    if (!error) {
      const items = (data || []) as RankedEvent[];
      return { items, hasMore: items.length >= page.limit };
    }
    // TODO: remove fallback once 20261030110000 is applied.
    if (error.code === '42883' || error.code === 'PGRST202') {
      if (page.offset > 0) return { items: [], hasMore: false };
      const { data: legacyData, error: legacyError } = await supabase.rpc(
        'get_ranked_events',
        { ...baseParams, result_limit: 100 }
      );
      if (legacyError) throw legacyError;
      return { items: (legacyData || []) as RankedEvent[], hasMore: false };
    }
    throw error;
  },

  async getEventDetails(eventId: string): Promise<EventDetails | null> {
    const { data, error } = await supabase.rpc('get_event_details', {
      event_uuid: eventId,
    });

    if (error) throw error;
    return data as EventDetails | null;
  },

  async trackEventView(eventId: string): Promise<void> {
    const { error } = await (supabase as any).rpc('track_event_view', {
      event_uuid: eventId,
    });
    if (error) {
      throw error;
    }
  },

  async createEvent(eventData: {
    businessId: string;
    title: string;
    description: string;
    categoryId: string;
    startDatetime: string;
    endDatetime: string;
    lat: number;
    lng: number;
    address: string;
    coverImageUrl?: string | null;
    isRecurring?: boolean;
    recurrencePattern?: {
      frequency: 'daily' | 'weekly' | 'monthly';
      interval: number;
      endDate?: string;
    } | null;
  }): Promise<string> {
    const { data, error } = await supabase.rpc('create_event_with_limit_check', {
      p_business_id: eventData.businessId,
      p_title: eventData.title,
      p_description: eventData.description,
      p_category_id: eventData.categoryId,
      p_start_datetime: eventData.startDatetime,
      p_end_datetime: eventData.endDatetime,
      p_lat: eventData.lat,
      p_lng: eventData.lng,
      p_address: eventData.address,
      p_cover_image_url: eventData.coverImageUrl || undefined,
      p_is_recurring: eventData.isRecurring ?? false,
      p_recurrence_pattern: eventData.recurrencePattern ?? null,
    });

    if (error) throw error;
    const eventId =
      typeof data === 'string' ? data : (data as { id?: string })?.id;
    if (!eventId) throw new Error('Event was created but no ID was returned');
    return eventId;
  },

  async updateEvent(eventId: string, updates: Partial<Event>): Promise<void> {
    const { error } = await supabase
      .from('events')
      .update(updates)
      .eq('id', eventId);

    if (error) throw error;
  },

  /**
   * Soft-cancels an event via the cancel_event RPC (20261030106000): keeps the
   * row, sets status='cancelled' and notifies going/interested attendees.
   * While that migration is unapplied the RPC doesn't exist, so this falls
   * back to the legacy hard delete (identical to today's behavior).
   */
  async cancelEvent(eventId: string): Promise<void> {
    const { error } = await (supabase as any).rpc('cancel_event', {
      p_event_id: eventId,
    });
    if (!error) return;
    // TODO: remove fallback once 20261030106000 is applied
    if (error.code === '42883' || error.code === 'PGRST202') {
      await this.deleteEvent(eventId);
      return;
    }
    throw error;
  },

  async deleteEvent(eventId: string): Promise<void> {
    const { error } = await supabase.from('events').delete().eq('id', eventId);

    if (error) throw error;
  },

  async getBusinessEvents(
    businessId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<Event[]> {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    let query = supabase
      .from('events')
      .select('*')
      .eq('business_id', businessId)
      .order('start_datetime', { ascending: true })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) throw error;
    return (data || []) as Event[];
  },

  async getBusinessEventsCount(businessId: string): Promise<number> {
    const { count, error } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId);

    if (error) throw error;
    return count ?? 0;
  },

  async addEventLink(
    eventId: string,
    label: string | null,
    url: string,
    sortOrder: number
  ): Promise<void> {
    const { error } = await supabase.from('event_links').insert({
      event_id: eventId,
      label,
      url,
      sort_order: sortOrder,
    });

    if (error) throw error;
  },

  async deleteEventLink(linkId: string): Promise<void> {
    const { error } = await supabase
      .from('event_links')
      .delete()
      .eq('id', linkId);

    if (error) throw error;
  },

  async addEventPhoto(
    eventId: string,
    imageUrl: string,
    sortOrder: number
  ): Promise<void> {
    const { error } = await supabase.from('event_photos').insert({
      event_id: eventId,
      image_url: imageUrl,
      sort_order: sortOrder,
    });

    if (error) throw error;
  },

  async deleteEventPhoto(photoId: string): Promise<void> {
    const { error } = await supabase
      .from('event_photos')
      .delete()
      .eq('id', photoId);

    if (error) throw error;
  },

  async uploadEventImage(
    file: { uri: string; name: string; type: string },
    folder: 'events' | 'logos' | 'venues' = 'events'
  ): Promise<string> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}.${fileExt}`;
    // Paths are prefixed with the uploader's user id: the storage policies
    // (20261030102000) scope INSERT/UPDATE/DELETE to the caller's own folder.
    // This layout is also accepted by the pre-migration policies, so it is
    // safe to ship before the migration is applied.
    const filePath = `${user.id}/${folder}/${fileName}`;

    // Read file as base64 using the legacy expo-file-system API
    const base64 = await FileSystem.readAsStringAsync(file.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Convert base64 to ArrayBuffer for Supabase upload
    const arrayBuffer = decode(base64);

    const { data, error } = await supabase.storage
      .from('event-images')
      .upload(filePath, arrayBuffer, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      });

    if (error) throw error;

    const {
      data: { publicUrl },
    } = supabase.storage.from('event-images').getPublicUrl(data.path);

    return publicUrl;
  },
};
