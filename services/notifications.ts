/**
 * Notifications service.
 * Fetches user notifications from Supabase.
 */

import { supabase } from './supabase';

export type NotificationType =
  | 'event_reminder'
  | 'new_follower'
  | 'new_event_from_followed'
  | 'event_update'
  | 'rsvp'
  | 'nearby_event'
  | 'promotion';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: Date;
  read: boolean;
  eventId?: string;
}

/**
 * Fetch notifications for the current user.
 */
export async function getNotifications(): Promise<Notification[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, read, event_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body || '',
    timestamp: new Date(row.created_at),
    read: row.read ?? false,
    eventId: row.event_id ?? undefined,
  }));
}

/**
 * Mark a notification as read.
 */
export async function markNotificationAsRead(id: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', user.id);
}

/**
 * Mark all notifications as read for the current user.
 */
export async function markAllNotificationsAsRead(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id);
}

/**
 * Delete a notification (dismiss).
 */
export async function deleteNotification(id: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
}
