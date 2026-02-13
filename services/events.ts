import { supabase } from './supabase';
import { RankedEvent, EventDetails, Event } from '@/types/database';
import { FilterOptions } from '@/types/app';

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
    });

    if (error) throw error;
    return data;
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

  async getBusinessEvents(businessId: string): Promise<Event[]> {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('business_id', businessId)
      .order('start_datetime', { ascending: true });

    if (error) throw error;
    return data || [];
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

  async uploadEventImage(file: {
    uri: string;
    name: string;
    type: string;
  }): Promise<string> {
    const fileExt = file.name.split('.').pop();
    const filePath = `${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}.${fileExt}`;

    const formData = new FormData();
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any);

    const { data, error } = await supabase.storage
      .from('event-images')
      .upload(filePath, formData);

    if (error) throw error;

    const {
      data: { publicUrl },
    } = supabase.storage.from('event-images').getPublicUrl(data.path);

    return publicUrl;
  },
};
