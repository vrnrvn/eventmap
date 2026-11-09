import { Platform } from 'react-native';
import { signalEventWrites } from '@/utils/eventDataVersion';
import { supabase, getSessionUser } from './supabase';
import type { RankedEvent, EventDetails, Event, EventLink, EventVisibility, AgeRestriction } from '@/types/database';

import { FilterOptions } from '@/types/app';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { imageCleanupMayRun, releaseEventImages } from './storageCleanup';
import * as ImageManipulator from 'expo-image-manipulator';
import { THUMBNAIL_WIDTH, markedUploadName, thumbnailOf } from '@/utils/imageThumbnails';
import { isConnectionError } from '@/utils/networkErrors';
import { rpcArgs } from './rpcArgs';

/**
 * Create keys whose last attempt ended without an answer (connection lost
 * mid-request): the event may exist even though the call failed.
 */
const uncertainCreates = new Set<string>();
/** Set once the server shows it doesn't know p_client_request_id (pending migration). */
let createKeyParamUnsupported = false;
/** How far back a retry looks for the event an uncertain attempt created. */
const RECOVERY_WINDOW_MS = 30 * 60 * 1000;

const isMissingFunction = (err: { code?: string } | null | undefined) =>
  err?.code === '42883' || err?.code === 'PGRST202';

export type CreateEventResult = {
  id: string;
  capacityApplied: boolean;
  timezoneApplied: boolean;
  extrasApplied: boolean;
  /** True when a retry found the event an earlier, unanswered attempt created. */
  recovered?: boolean;
};

export type CreateEventInput = {
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
  /**
   * One uuid per form session. Retrying with the same key never creates a
   * second event: the server dedupes on it (pending
   * 20261108100000_event_create_idempotency) and, until that is applied, a
   * retry after a lost response first looks for the event it created.
   */
  requestKey?: string;
};

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

// expo-file-system/legacy has no web implementation (readAsStringAsync is
// an unavailable stub there), so on web the picker's blob:/data: URI is
// fetched straight into a Blob. Native keeps the base64 → ArrayBuffer path.
async function readUploadBody(uri: string): Promise<Blob | ArrayBuffer> {
  return Platform.OS === 'web'
    ? await (await fetch(uri)).blob()
    : decode(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }));
}

/** Cover + photo URLs of an event, for releasing its files after a delete. */
async function eventImageUrls(eventId: string): Promise<string[]> {
  try {
    const [ev, photos] = await Promise.all([
      supabase.from('events').select('cover_image_url').eq('id', eventId).maybeSingle(),
      supabase.from('event_photos').select('image_url').eq('event_id', eventId),
    ]);
    const urls = ((photos.data ?? []) as { image_url: string }[]).map((p) => p.image_url);
    const cover = (ev.data as { cover_image_url?: string | null } | null)?.cover_image_url;
    return cover ? [cover, ...urls] : urls;
  } catch {
    return [];
  }
}

async function currentCover(eventId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('events').select('cover_image_url').eq('id', eventId).maybeSingle();
    return (data as { cover_image_url?: string | null } | null)?.cover_image_url ?? null;
  } catch {
    return null;
  }
}

/** event_rsvp_counts missing on this backend (per session); skip the light poll. */
let liveStatusUnavailable = false;
let liveChannelSeq = 0;

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

  /**
   * Lightweight live status for an open event page: the public going-count
   * row (event_rsvp_counts, trigger-maintained) plus the event's lifecycle
   * status. Replaces polling the full get_event_details payload (event +
   * business + photos + links + waitlist) every 20 s just to read two fields.
   *
   * `status: null` means the events row is no longer visible to this viewer —
   * for a page that was open that means cancelled (or unpublished), which RLS
   * hides from non-owners; the caller should fall back to the full details
   * fetch to learn which. Returns null (and remembers it) when the counts
   * table isn't in the shared DB yet, so callers can keep the old full poll.
   */
  async getEventLiveStatus(
    eventId: string
  ): Promise<{ goingCount: number | null; status: string | null } | null> {
    if (liveStatusUnavailable) return null;
    const [counts, ev] = await Promise.all([
      supabase.from('event_rsvp_counts').select('going_count').eq('event_id', eventId).maybeSingle(),
      supabase.from('events').select('status').eq('id', eventId).maybeSingle(),
    ]);
    if (counts.error || ev.error) {
      // Missing table (42P01 from Postgres, PGRST205 from current PostgREST):
      // remember it for the session. Any error returns null so the caller
      // falls back to the full details fetch instead of silently going stale.
      const code = (counts.error as { code?: string } | null)?.code;
      if (code === '42P01' || code === 'PGRST205') liveStatusUnavailable = true;
      return null;
    }
    return {
      // No row yet = no RSVPs yet.
      goingCount: counts.data ? (counts.data as { going_count: number }).going_count : 0,
      status: ev.data ? ((ev.data as { status: string | null }).status ?? 'active') : null,
    };
  },

  /**
   * Realtime: fires whenever this event's row in event_rsvp_counts changes
   * (20261102130000 puts the table in the publication; it is public-read, so
   * the subscription works for any viewer). The caller refetches on each
   * change and keeps its poll as the fallback — a subscription can silently
   * miss changes across reconnects. Returns the unsubscribe.
   */
  subscribeEventLiveStatus(eventId: string, onChange: () => void): () => void {
    if (liveStatusUnavailable) return () => {};
    // Unique per subscriber: supabase.channel(topic) hands back an existing
    // instance for the same topic, so two open copies of one event page would
    // share a channel and closing either would unsubscribe both.
    liveChannelSeq += 1;
    const channel = supabase
      .channel(`event-live:${eventId}:${liveChannelSeq}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_rsvp_counts', filter: `event_id=eq.${eventId}` },
        () => onChange()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel).catch(() => undefined);
    };
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
    // Bound: supabase.rpc reads `this` (an extracted method throws).
    const rpc = supabase.rpc.bind(supabase) as unknown as (
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

  /** True when the last create with this key ended without an answer. */
  hasUncertainCreate(requestKey: string): boolean {
    return uncertainCreates.has(requestKey);
  },

  async createEvent(eventData: CreateEventInput): Promise<CreateEventResult> {
    const key = eventData.requestKey;
    if (key && uncertainCreates.has(key)) {
      // Throws when still offline, which is the right message for the user.
      const existingId = await this.findRecentlyCreated(eventData);
      if (existingId) {
        uncertainCreates.delete(key);
        const extrasApplied = await this.applyExtras(existingId, eventData.extras);
        return { id: existingId, capacityApplied: true, timezoneApplied: true, extrasApplied, recovered: true };
      }
    }
    try {
      const result = await this.createEventOnce(eventData);
      if (key) uncertainCreates.delete(key);
      return result;
    } catch (err) {
      if (key && isConnectionError(err)) uncertainCreates.add(key);
      throw err;
    }
  },

  /**
   * The event this business created moments ago with the same title and
   * start, if any. Used only after an attempt whose outcome is unknown.
   */
  async findRecentlyCreated(eventData: {
    businessId: string;
    title: string;
    startDatetime: string;
    publishState?: 'draft' | 'published';
  }): Promise<string | null> {
    const { data, error } = await supabase
      .from('events')
      .select('id')
      .eq('business_id', eventData.businessId)
      .eq('title', eventData.title.trim())
      .eq('start_datetime', eventData.startDatetime)
      // A lost "Save as draft" must not be returned for a Publish.
      .eq('publish_state', eventData.publishState ?? 'published')
      .gte('created_at', new Date(Date.now() - RECOVERY_WINDOW_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data?.[0]?.id ?? null;
  },

  async createEventOnce(eventData: CreateEventInput): Promise<CreateEventResult> {
    // Every migration up to 20261106170000 is applied, so the RPC takes
    // capacity, time zone and publish state in one call (the old
    // drop-the-newest-params ladder and follow-up UPDATE are gone).
    const args = rpcArgs('create_event_with_limit_check', {
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
      p_max_attendees: eventData.maxAttendees ?? null,
      p_timezone: eventData.timezone ?? null,
      p_publish_state: eventData.publishState ?? 'published',
    });

    // p_client_request_id exists only once the pending idempotency migration
    // is applied (it isn't in the generated types yet). PostgREST resolves by
    // argument names, so an unknown name is PGRST202 and nothing ran; retry
    // without it and remember for the session.
    let res;
    if (eventData.requestKey && !createKeyParamUnsupported) {
      const withKey = supabase.rpc.bind(supabase) as unknown as (
        f: 'create_event_with_limit_check',
        a: typeof args & { p_client_request_id: string }
      ) => ReturnType<typeof supabase.rpc<'create_event_with_limit_check'>>;
      res = await withKey('create_event_with_limit_check', {
        ...args,
        p_client_request_id: eventData.requestKey,
      });
      if (isMissingFunction(res.error)) {
        res = await supabase.rpc('create_event_with_limit_check', args);
        if (!isMissingFunction(res.error)) createKeyParamUnsupported = true;
      }
    } else {
      res = await supabase.rpc('create_event_with_limit_check', args);
    }
    if (res.error) throw res.error;

    const eventId = res.data;
    if (!eventId) throw new Error('Event was created but no ID was returned');
    const extrasApplied = await this.applyExtras(eventId, eventData.extras);
    return { id: eventId, capacityApplied: true, timezoneApplied: true, extrasApplied };
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
    // A replaced cover may leave its file unused.
    const previousCover =
      'cover_image_url' in updates && imageCleanupMayRun() ? await currentCover(eventId) : undefined;
    const { error } = await supabase
      .from('events')
      .update(updates)
      .eq('id', eventId);

    if (error) throw error;
    if (previousCover && previousCover !== updates.cover_image_url) releaseEventImages([previousCover]);
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
    // Files to release once the row (and its cascaded photos) is gone.
    const images = imageCleanupMayRun() ? await eventImageUrls(eventId) : [];
    const { error } = await supabase.from('events').delete().eq('id', eventId);

    if (error) throw error;
    releaseEventImages(images);
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

    const build = () => {
      let query = supabase.from('events').select('*').eq('business_id', businessId);
      if (scope === 'drafts') {
        return query.eq('publish_state', 'draft').order('updated_at', { ascending: false });
      }
      query = query.eq('publish_state', 'published');
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

    const res = await build().range(offset, offset + limit - 1);
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
    if (!error) return;

    // A lost response may hide a committed insert. Every upload has a unique
    // URL, so "a row with this URL exists" means this very insert landed;
    // reporting it as failed would make the host add the photo again and
    // show it twice.
    if (isConnectionError(error)) {
      try {
        const { data } = await supabase
          .from('event_photos')
          .select('id')
          .eq('event_id', eventId)
          .eq('image_url', imageUrl)
          .limit(1);
        if (data && data.length > 0) return;
      } catch {
        // Still offline: fall through and report the failure.
      }
    }
    // The file was uploaded but never attached; free it (the server only
    // removes files nothing references, so this is safe if the row exists).
    releaseEventImages([imageUrl]);
    throw error;
  },

  async updateEventPhotoOrder(photoId: string, sortOrder: number): Promise<void> {
    const { error } = await supabase
      .from('event_photos')
      .update({ sort_order: sortOrder })
      .eq('id', photoId);

    if (error) throw error;
  },

  async deleteEventPhoto(photoId: string): Promise<void> {
    // Read the URL first (a separate select: DELETE ... RETURNING would also
    // apply the SELECT policy, which hides ended events' photos, and change
    // what can be deleted). Null just means no cleanup.
    const { data: row } = imageCleanupMayRun()
      ? await supabase.from('event_photos').select('image_url').eq('id', photoId).maybeSingle()
      : { data: null };
    const { error } = await supabase
      .from('event_photos')
      .delete()
      .eq('id', photoId);

    if (error) throw error;
    releaseEventImages([(row as { image_url?: string } | null)?.image_url]);
  },

  async uploadEventImage(
    file: { uri: string; name: string; type: string },
    folder: 'events' | 'logos' | 'venues' = 'events'
  ): Promise<string> {
    const user = await getSessionUser();
    if (!user) throw new Error('Not authenticated');

    const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const base = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const contentType = file.type || 'image/jpeg';
    const dir = `${user.id}/${folder}`;
    // Paths are prefixed with the uploader's user id: the storage policies
    // (20261030102000) scope INSERT/UPDATE/DELETE to the caller's own folder.

    // JPEGs (every picker path) also get a 512 px sibling for small renders
    // (utils/imageThumbnails). It's uploaded FIRST and the original only
    // carries the "has thumbnail" marker if that worked, so a marked URL
    // always has its sibling. Best-effort: any failure just means no marker.
    let fileName = `${base}.${fileExt}`;
    if (fileExt === 'jpg' || fileExt === 'jpeg') {
      try {
        const small = await ImageManipulator.manipulateAsync(
          file.uri,
          [{ resize: { width: THUMBNAIL_WIDTH } }],
          { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
        );
        const marked = markedUploadName(base);
        const { error: thumbError } = await supabase.storage
          .from('event-images')
          .upload(`${dir}/${thumbnailOf(marked)}`, await readUploadBody(small.uri), {
            contentType: 'image/jpeg',
            upsert: false,
          });
        if (!thumbError) fileName = marked;
      } catch {
        // Keep the unmarked name: small renders use the original.
      }
    }
    const filePath = `${dir}/${fileName}`;
    const body = await readUploadBody(file.uri);

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

// Writes that can change an event page bump the shared version, so
// EventDetail can safely skip a focus refetch when nothing changed.
signalEventWrites(eventsService, ['createEvent', 'applyExtras', 'updateEvent', 'cancelEvent', 'deleteEvent', 'addEventLink', 'syncEventLinks', 'deleteEventLink', 'addEventPhoto', 'updateEventPhotoOrder', 'deleteEventPhoto']);
