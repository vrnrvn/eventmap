/**
 * Notifications service.
 * Fetches user notifications from Supabase.
 */

import { supabase, getSessionUser } from './supabase';

export type NotificationType =
  | 'event_reminder'
  | 'new_follower'
  | 'new_event_from_followed'
  | 'event_update'
  | 'rsvp'
  | 'nearby_event'
  /** New event in a preferred category nearby (20261109170000, opt-in). */
  | 'interest_event'
  | 'promotion'
  | 'chat_message'
  | 'chat_mention'
  | 'waitlist'
  | 'moderation'
  | 'report_update'
  | 'host_announcement'
  /**
   * Notices addressed to the host (20261110160000 + 20261113110000, both
   * opt-in and off by default). Listed here so they render with their own
   * icon and routing rather than the unknown-type fallback.
   */
  | 'host_day_of'
  | 'host_post_event_summary'
  | 'host_verification_update'
  | 'host_standing_update';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: Date;
  read: boolean;
  eventId?: string;
  businessId?: string;
  messageId?: string;
}

type RealtimeNotificationHandler = {
  onInsert?: (notification: Notification) => void;
  onUpdate?: (notification: Notification) => void;
  onDelete?: (id: string) => void;
  /**
   * The channel rejoined after a drop. Changes made in between were never
   * delivered, so the subscriber should reload (backfill).
   */
  onResubscribed?: () => void;
};

function mapRowToNotification(row: any): Notification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body || '',
    timestamp: new Date(row.created_at),
    read: row.read ?? false,
    eventId: row.event_id ?? undefined,
    businessId: row.business_id ?? undefined,
    messageId: typeof row.data?.messageId === 'string' ? row.data.messageId : undefined,
  };
}

export const NOTIFICATIONS_PAGE_SIZE = 30;

/**
 * One page of notifications, newest first. Ordered by (created_at, id) so the
 * offset is stable when rows share a timestamp.
 */
export async function getNotificationsPage(
  page: { limit?: number; offset?: number } = {}
): Promise<{ items: Notification[]; hasMore: boolean }> {
  const limit = page.limit ?? NOTIFICATIONS_PAGE_SIZE;
  const offset = page.offset ?? 0;
  const user = await getSessionUser();
  if (!user) return { items: [], hasMore: false };

  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, read, event_id, business_id, created_at, data')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  const items = (data || []).map(mapRowToNotification);
  return { items, hasMore: items.length >= limit };
}

/**
 * Fetch the first page of notifications for the current user.
 */
export async function getNotifications(): Promise<Notification[]> {
  const { items } = await getNotificationsPage();
  return items;
}

/**
 * Exact unread-notification count for the current user. Head-only request —
 * no rows travel, just the count — so it is cheap to refetch often (realtime
 * bumps, app foreground).
 */
export async function getUnreadNotificationCount(): Promise<number> {
  const user = await getSessionUser();
  if (!user) return 0;

  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('read', false);

  if (error) throw error;
  return count ?? 0;
}

/**
 * Mark a notification as read.
 */
export async function markNotificationAsRead(id: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const { error } = await (supabase as any)
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
}

/**
 * Mark all notifications as read for the current user.
 */
export async function markAllNotificationsAsRead(): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const { error } = await (supabase as any)
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id);
  if (error) throw error;
}

/**
 * Delete a notification (dismiss).
 */
export async function deleteNotification(id: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
}

export function subscribeToNotifications(
  userId: string,
  handlers: RealtimeNotificationHandler,
  /**
   * Distinguishes concurrent subscribers. Supabase channels are keyed by
   * topic, so two subscriptions with the same topic collide (the second join
   * supersedes the first, and either unmount removes both).
   */
  channelSuffix = ''
): () => void {
  let joinedOnce = false;
  const channel = supabase
    .channel(`notifications${channelSuffix}:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        handlers.onInsert?.(mapRowToNotification(payload.new));
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        handlers.onUpdate?.(mapRowToNotification(payload.new));
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        handlers.onDelete?.(String((payload.old as any).id));
      }
    )
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      if (joinedOnce) handlers.onResubscribed?.();
      joinedOnce = true;
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
