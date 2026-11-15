/**
 * Where tapping a notification goes — the ONE rule for both entry points:
 * the in-app list (`app/(tabs)/notifications.tsx`) and a tapped push
 * (`app/_layout.tsx`, via `routeFromPushData`).
 *
 * Pure and route-table-free so it can be unit-tested under node; the screen
 * just pushes what this returns.
 *
 * History: written for the host notices (docs/HOST_EVENT_PLAYBOOK_PLAN.md
 * P6) because they carry an `eventId` like any other notification, so the
 * old inline rule sent a host who tapped "your event is today" to the public
 * attendee page instead of the hub where the tools are. The push path kept
 * its own older copy of that inline rule until 2026-11-14 (flow 3 pass), so a
 * *push* for a host notice still went to the attendee page. Both paths now
 * resolve here.
 */
export type NotificationRouteInput = {
  type: string;
  eventId?: string;
  businessId?: string;
  messageId?: string;
  /** Push payloads from the chat triggers carry `kind: 'chat'` (20261028120000). */
  kind?: string;
};

export type NotificationRouteOptions = {
  /**
   * Where to go when the notification points nowhere. The in-app list falls
   * back to Discover; a tapped push falls back to the notification centre
   * (that is what the user asked for by tapping it), or to the promotion's
   * deep link when it has one.
   */
  fallback?: string;
};

/** Notices addressed to a host about their own event. */
const HOST_EVENT_NOTICES = new Set(['host_day_of', 'host_post_event_summary']);
/** Notices about the host's profile rather than one event. */
const HOST_PROFILE_NOTICES = new Set(['host_verification_update', 'host_standing_update']);

export const IN_APP_FALLBACK = '/(tabs)/discover';
export const PUSH_FALLBACK = '/(tabs)/notifications';

export function notificationRoute(n: NotificationRouteInput, opts: NotificationRouteOptions = {}): string {
  if (HOST_PROFILE_NOTICES.has(n.type)) return '/settings';

  if (n.eventId) {
    if (n.type === 'chat_message' || n.type === 'chat_mention' || n.kind === 'chat') {
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
  return opts.fallback ?? IN_APP_FALLBACK;
}

/**
 * A tapped push's `data` → route. The server builds `data` as
 * `{ notificationId, type, eventId, businessId } || notifications.data`
 * (20261108130000), so the keys mirror the row plus any per-type extras
 * (`messageId`, `kind`, promotions' `linkUrl`). Everything is checked to be a
 * non-empty string because push payloads are untyped at the edge.
 *
 * `parseLinkPath` turns a `myapp://…` deep link into an app path (the caller
 * passes `expo-linking`'s parser; kept out of here so this stays node-pure).
 */
export function routeFromPushData(
  data: Record<string, unknown> | null | undefined,
  parseLinkPath: (url: string) => string | null | undefined
): string {
  if (!data || typeof data !== 'object') return PUSH_FALLBACK;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

  let fallback = PUSH_FALLBACK;
  const linkUrl = str(data.linkUrl);
  if (linkUrl && linkUrl.startsWith('myapp://')) {
    const path = parseLinkPath(linkUrl);
    if (path) fallback = `/${path.replace(/^\/+/, '')}`;
  }

  return notificationRoute(
    {
      type: str(data.type) ?? '',
      eventId: str(data.eventId),
      businessId: str(data.businessId),
      messageId: str(data.messageId),
      kind: str(data.kind),
    },
    { fallback }
  );
}
