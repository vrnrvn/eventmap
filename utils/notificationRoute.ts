/**
 * Where tapping a notification goes (docs/HOST_EVENT_PLAYBOOK_PLAN.md P6).
 *
 * Pure and route-table-free so it can be unit-tested under node; the screen
 * just pushes what this returns.
 *
 * Host notices are the reason this exists: they carry an `eventId` like any
 * other notification, so the old inline rule sent a host who tapped "your
 * event is today" to the public attendee page instead of the hub where the
 * tools are.
 */
export type NotificationRouteInput = {
  type: string;
  eventId?: string;
  businessId?: string;
  messageId?: string;
};

/** Notices addressed to a host about their own event. */
const HOST_EVENT_NOTICES = new Set(['host_day_of', 'host_post_event_summary']);
/** Notices about the host's profile rather than one event. */
const HOST_PROFILE_NOTICES = new Set(['host_verification_update', 'host_standing_update']);

export function notificationRoute(n: NotificationRouteInput): string {
  if (HOST_PROFILE_NOTICES.has(n.type)) return '/settings';

  if (n.eventId) {
    if (n.type === 'chat_message' || n.type === 'chat_mention') {
      return n.messageId
        ? `/event-chat/${n.eventId}?messageId=${n.messageId}`
        : `/event-chat/${n.eventId}`;
    }
    if (HOST_EVENT_NOTICES.has(n.type)) {
      // The summary's whole point is "here is what to do next", so it opens
      // the after-the-event checklist rather than just the hub.
      return n.type === 'host_post_event_summary'
        ? `/business/manage-event/${n.eventId}?checklist=1`
        : `/business/manage-event/${n.eventId}`;
    }
    return `/event/${n.eventId}`;
  }

  if (n.businessId) return `/business/${n.businessId}`;
  return '/(tabs)/discover';
}
