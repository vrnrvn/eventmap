import { Platform } from 'react-native';
import { supabase } from './supabase';
import type { RankedEvent, EventDetails, Event, EventLink, EventVisibility, AgeRestriction } from '@/types/database';

import { FilterOptions } from '@/types/app';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

/** Optional detail fields a host can set (20261103150000). Empty strings mean "clear". */
export type EventExtras = {
  visibility?: EventVisibility;
  ticketUrl?: string;
  priceLabel?: string;
  ageRestriction?: AgeRestriction;
  accessibilityNotes?: string;
  whatToBring?: string;
};

export function extrasToUpdates(extras: EventExtras): Partial<Event> {
  const u: Partial<Event> = {};
  const text = (v: string | undefined) => (v === undefined ? undefined : v.trim() ? v.trim() : null);
  if (extras.visibility !== undefined) u.visibility = extras.visibility;
  if (extras.ageRestriction !== undefined) u.age_restriction = extras.ageRestriction;
  const ticket = text(extras.ticketUrl);
  if (ticket !== undefined) u.ticket_url = ticket;
  const price = text(extras.priceLabel);
  if (price !== undefined) u.price_label = price;
  const access = text(extras.accessibilityNotes);
  if (access !== undefined) u.accessibility_notes = access;
  const bring = text(extras.whatToBring);
  if (bring !== undefined) u.what_to_bring = bring;
  return u;
}

export type EventInteractionKind = 'share' | 'ticket' | 'calendar' | 'directions';

export const eventsService = {
  /**
   * One page of ranked events around a point. `hasMore` is inferred from a
   * full page; callers stop paging when a short page comes back.
   */
  async getRankedEventsPage(
    userLat: number,
    userLng: number,
    filters: Partial<FilterOptions> = {},
    page: { limit: number; offset: number }
  ): Promise<{ items: RankedEvent[]; hasMore: boolean }> {
    const { data, error } = await supabase.rpc('get_ranked_events', {
      user_lat: userLat,
      user_lng: userLng,
      radius_km: filters.radiusKm || 50,
      category_ids: filters.categories?.length ? filters.categories : undefined,
      start_date: filters.startDate?.toISOString(),
      end_date: filters.endDate?.toISOString(),
      search_query: filters.searchQuery || undefined,
      result_limit: page.limit,
      p_offset: page.offset,
    });
    if (error) throw error;
    const items = (data || []) as RankedEvent[];
    return { items, hasMore: items.length >= page.limit };
  },

  async getEventDetails(eventId: string): Promise<EventDetails | null> {
    const { data, error } = await supabase.rpc('get_event_details', {
      event_uuid: eventId,
    });

    if (error) throw error;
    return data as EventDetails | null;
  },

  /**
   * Records a share / ticket / calendar / directions tap for host insights
   * (track_event_interaction, 20261104090000). Fire-and-forget: never throws,
   * and is a no-op while that migration isn't applied. The server dedupes to
   * one tap per person, kind and day and ignores the host's own taps.
   */
  trackEventInteraction(eventId: string, kind: EventInteractionKind): void {
    const rpc = supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => PromiseLike<{ error: unknown }>;
    void Promise.resolve(rpc('track_event_interaction', { p_event_id: eventId, p_kind: kind })).catch(() => {});
  },

  async trackEventView(eventId: string): Promise<void> {
    const { error } = await supabase.rpc('track_event_view', {
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
    /** Going-capacity cap; null/undefined = unlimited. */
    maxAttendees?: number | null;
    /** IANA zone the times were entered in (20261103140000). */
    timezone?: string | null;
    /** 'draft' keeps the event private and free until publish_event (20261103150000). */
    publishState?: 'draft' | 'published';
    /** Optional detail fields (20261103150000); written with a follow-up UPDATE. */
    extras?: EventExtras;
  }): Promise<{ id: string; capacityApplied: boolean; timezoneApplied: boolean; extrasApplied: boolean }> {
    const args = {
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
    };
    const wantsCapacity = eventData.maxAttendees != null;
    const wantsTimezone = !!eventData.timezone;
    const wantsDraft = eventData.publishState === 'draft';

    // The RPC has grown optional trailing parameters in unapplied migrations:
    // p_max_attendees (20261103120000) and p_timezone (20261103140000).
    // PostgREST resolves overloads by argument names, so an unknown name is
    // reported as a missing function (PGRST202 / 42883). Try the richest
    // shape first and drop the newest extras until one is accepted; whatever
    // could not be sent in the create call is written with a follow-up UPDATE.
    const untyped = supabase.rpc as unknown as (
      f: string,
      a: Record<string, unknown>
    ) => ReturnType<typeof supabase.rpc>;
    const attempts: { args: Record<string, unknown>; capacity: boolean; timezone: boolean }[] = [];
    if (wantsDraft) {
      // Drafts exist only with 20261103150000; there is no older shape that
      // can express one, so this attempt is not allowed to fall back.
      const res = await untyped('create_event_with_limit_check', {
        ...args,
        p_max_attendees: eventData.maxAttendees ?? null,
        p_timezone: eventData.timezone ?? null,
        p_publish_state: 'draft',
      });
      if (res.error) {
        if (res.error.code === '42883' || res.error.code === 'PGRST202') {
          throw new Error('Drafts need a database update that has not been applied yet.');
        }
        throw res.error;
      }
      const draftId = typeof res.data === 'string' ? res.data : (res.data as { id?: string })?.id;
      if (!draftId) throw new Error('Event was created but no ID was returned');
      const extrasApplied = await this.applyExtras(draftId, eventData.extras);
      return { id: draftId, capacityApplied: true, timezoneApplied: true, extrasApplied };
    }
    if (wantsTimezone) {
      attempts.push({
        args: { ...args, p_max_attendees: eventData.maxAttendees ?? null, p_timezone: eventData.timezone },
        capacity: true,
        timezone: true,
      });
    }
    if (wantsCapacity) {
      attempts.push({ args: { ...args, p_max_attendees: eventData.maxAttendees }, capacity: true, timezone: false });
    }
    attempts.push({ args, capacity: false, timezone: false });

    let data: unknown;
    let capacityApplied = !wantsCapacity;
    let timezoneApplied = !wantsTimezone;
    for (const attempt of attempts) {
      const res = await untyped('create_event_with_limit_check', attempt.args);
      if (!res.error) {
        data = res.data;
        if (attempt.capacity) capacityApplied = true;
        if (attempt.timezone) timezoneApplied = true;
        break;
      }
      const missing = res.error.code === '42883' || res.error.code === 'PGRST202';
      if (!missing || attempt === attempts[attempts.length - 1]) throw res.error;
    }

    const eventId = typeof data === 'string' ? data : (data as { id?: string })?.id;
    if (!eventId) throw new Error('Event was created but no ID was returned');

    const followUp: Partial<Event> = {};
    if (!capacityApplied) followUp.max_attendees = eventData.maxAttendees ?? null;
    if (!timezoneApplied) followUp.timezone = eventData.timezone ?? null;
    if (Object.keys(followUp).length > 0) {
      try {
        await this.updateEvent(eventId, followUp);
        capacityApplied = true;
        timezoneApplied = true;
      } catch {
        // The timezone column may not exist yet (unapplied migration); retry
        // the capacity alone so at least that lands. Reported to the caller.
        if (!capacityApplied && 'timezone' in followUp) {
          try {
            await this.updateEvent(eventId, { max_attendees: eventData.maxAttendees ?? null });
            capacityApplied = true;
          } catch {
            // reported below
          }
        }
      }
    }
    const extrasApplied = await this.applyExtras(eventId, eventData.extras);
    return { id: eventId, capacityApplied, timezoneApplied, extrasApplied };
  },

  /**
   * Writes the optional detail columns (20261103150000). Returns false when
   * the columns do not exist yet or the write failed; the event itself is fine.
   */
  async applyExtras(eventId: string, extras: EventExtras | undefined): Promise<boolean> {
    if (!extras) return true;
    const updates = extrasToUpdates(extras);
    if (Object.keys(updates).length === 0) return true;
    try {
      await this.updateEvent(eventId, updates);
      return true;
    } catch {
      return false;
    }
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
   * Never falls back to a hard delete — if the RPC is missing the call fails
   * loudly rather than silently destroying RSVPs and chat history.
   */
  async cancelEvent(eventId: string): Promise<void> {
    const { error } = await supabase.rpc('cancel_event', {
      p_event_id: eventId,
    });
    if (error) throw error;
  },

  async deleteEvent(eventId: string): Promise<void> {
    const { error } = await supabase.from('events').delete().eq('id', eventId);

    if (error) throw error;
  },

  /**
   * A host's (or venue page's) events.
   *
   *  - `upcoming`: active events that haven't ended, soonest first. Recurring
   *    series are included regardless of their first start; callers that
   *    need the series' own end date to be honoured filter with
   *    `hasEventEnded`, which mirrors the server's `event_has_ended`.
   *  - `past`: cancelled events plus anything whose (first) end has passed,
   *    most recent first. Ongoing recurring series also match and should be
   *    dropped by the caller with `hasEventEnded`.
   *  - `all` (default): everything, oldest first (legacy ordering).
   *
   * Visibility is still governed by RLS: visitors only see active events
   * whose end hasn't passed; owners see their full history.
   */
  async getBusinessEvents(
    businessId: string,
    opts?: { limit?: number; offset?: number; scope?: 'upcoming' | 'past' | 'drafts' | 'all' }
  ): Promise<Event[]> {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const scope = opts?.scope ?? 'all';
    const nowIso = new Date().toISOString();

    // `publish_state` arrives with 20261103150000. Until then the column is
    // unknown to PostgREST (42703); the filters below are retried without it,
    // which is harmless because no drafts can exist before the migration.
    const build = (withPublishState: boolean) => {
      let query = supabase.from('events').select('*').eq('business_id', businessId);
      if (scope === 'drafts') {
        return query.eq('publish_state', 'draft').order('updated_at', { ascending: false });
      }
      if (withPublishState) query = query.eq('publish_state', 'published');
      if (scope === 'upcoming') {
        query = query
          .in('status', ['active', 'postponed'])
          .or(`end_datetime.gt.${nowIso},is_recurring.eq.true`)
          .order('start_datetime', { ascending: true });
      } else if (scope === 'past') {
        // Includes active recurring series whose first end has passed; callers
        // decide with hasEventEnded whether the series itself is over (an
        // ongoing one belongs in 'upcoming', a finished one here).
        query = query
          .or(`status.eq.cancelled,end_datetime.lte.${nowIso}`)
          .order('start_datetime', { ascending: false });
      } else {
        query = query.order('start_datetime', { ascending: true });
      }
      return query;
    };

    let res = await build(true).range(offset, offset + limit - 1);
    if (res.error && res.error.code === '42703') {
      if (scope === 'drafts') return [];
      res = await build(false).range(offset, offset + limit - 1);
    }
    if (res.error) throw res.error;
    return (res.data || []) as Event[];
  },

  /**
   * Row count for a business's events. `scope: 'upcoming'` counts only active
   * events that haven't ended — what the venue page's "Upcoming" stat means.
   * (Recurring series whose own end date passed are still counted here; the
   * server can't evaluate that in a PostgREST filter. Rare enough to accept
   * rather than fetch every row just to count them.)
   */
  async getBusinessEventsCount(
    businessId: string,
    opts?: { scope?: 'upcoming' | 'all' }
  ): Promise<number> {
    let query = supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId);

    if (opts?.scope === 'upcoming') {
      query = query
        .eq('status', 'active')
        .or(`end_datetime.gt.${new Date().toISOString()},is_recurring.eq.true`);
    }

    const { count, error } = await query;

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

  async getEventLinks(eventId: string): Promise<EventLink[]> {
    const { data, error } = await supabase
      .from('event_links')
      .select('*')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return (data || []) as EventLink[];
  },

  /**
   * Replaces an event's links with `links` (order = sort_order). Rows are
   * diffed rather than wiped and re-inserted so unchanged links keep their id
   * and created_at. Returns false when some change failed, so the caller can
   * warn without treating the whole save as broken.
   */
  async syncEventLinks(
    eventId: string,
    links: { id?: string; label: string | null; url: string }[]
  ): Promise<boolean> {
    const existing = await this.getEventLinks(eventId);
    const keptIds = new Set(links.map((l) => l.id).filter(Boolean) as string[]);
    let allOk = true;

    for (const row of existing) {
      if (keptIds.has(row.id)) continue;
      try {
        await this.deleteEventLink(row.id);
      } catch {
        allOk = false;
      }
    }

    for (const [index, link] of links.entries()) {
      const previous = link.id ? existing.find((row) => row.id === link.id) : undefined;
      try {
        if (!previous) {
          await this.addEventLink(eventId, link.label, link.url, index);
        } else if (
          previous.label !== link.label ||
          previous.url !== link.url ||
          previous.sort_order !== index
        ) {
          const { error } = await supabase
            .from('event_links')
            .update({ label: link.label, url: link.url, sort_order: index })
            .eq('id', link.id!);
          if (error) throw error;
        }
      } catch {
        allOk = false;
      }
    }
    return allOk;
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

  async updateEventPhotoOrder(photoId: string, sortOrder: number): Promise<void> {
    const { error } = await supabase
      .from('event_photos')
      .update({ sort_order: sortOrder })
      .eq('id', photoId);

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
    const filePath = `${user.id}/${folder}/${fileName}`;
    const contentType = file.type || 'image/jpeg';

    // expo-file-system/legacy has no web implementation (readAsStringAsync is
    // an unavailable stub there), so on web the picker's blob:/data: URI is
    // fetched straight into a Blob. Native keeps the base64 → ArrayBuffer path.
    const body: Blob | ArrayBuffer =
      Platform.OS === 'web'
        ? await (await fetch(file.uri)).blob()
        : decode(
            await FileSystem.readAsStringAsync(file.uri, {
              encoding: FileSystem.EncodingType.Base64,
            })
          );

    const { data, error } = await supabase.storage
      .from('event-images')
      .upload(filePath, body, {
        contentType,
        upsert: false,
      });

    if (error) throw error;

    const {
      data: { publicUrl },
    } = supabase.storage.from('event-images').getPublicUrl(data.path);

    return publicUrl;
  },
};
