/**
 * Notifications service.
 * Fetches user notifications. Wire to Supabase or your backend when ready.
 */

export type NotificationType =
  | 'event_reminder'
  | 'new_follower'
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
 * Returns empty array until a notifications backend is implemented.
 */
export async function getNotifications(): Promise<Notification[]> {
  // TODO: Replace with Supabase/realtime when notifications table exists
  return [];
}
