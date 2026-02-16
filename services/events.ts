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
      category_ids: filters.categories?.length ? filters.categories : null,
      start_date: filters.startDate?.toISOString() || null,
      end_date: filters.endDate?.toISOString() || null,
      search_query: filters.searchQuery || null,
      result_limit: 100,
    });

    if (error) throw error;
    return data || [];
  },

  async getEventDetails(eventId: string): Promise<EventDetails | null> {
    const { data, error } = await supabase.rpc('get_event_details', {
      event_uuid: eventId,
    });

    if (error) throw error;
    return data as EventDetails | null;
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
      p_cover_image_url: eventData.coverImageUrl || null,
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
    return data || [];
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
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}.${fileExt}`;
    const filePath = `${folder}/${fileName}`;

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