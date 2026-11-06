/**
 * Query keys for the list screens on React Query. Keep them here so screens
 * that change the underlying data (EventDetail RSVP / save) can invalidate
 * exactly the lists that depend on it.
 */
export const queryKeys = {
  savedEvents: () => ['events', 'saved'] as const,
  joinedEvents: (userId: string | undefined, scope: string) =>
    ['events', 'joined', userId ?? 'anon', scope] as const,
  /** Profile attendance counts (going / attended / saved / interested / requested). */
  attendanceCounts: (userId: string | undefined) => ['events', 'counts', userId ?? 'anon'] as const,
  /** Business-wide analytics for one window (get_business_analytics). */
  businessAnalytics: (businessId: string | undefined, days: number) => ['insights', 'business', businessId ?? 'none', days] as const,
  /** Host analytics for one event and window (get_event_insights). */
  eventInsights: (eventId: string | undefined, days: number) => ['insights', 'event', eventId ?? 'none', days] as const,
  /** Every calendar query for a user (refetch on focus / pull). */
  calendarPrefix: (userId: string | undefined) => ['events', 'calendar', userId ?? 'anon'] as const,
  /** Phase A fallback: one cached list per calendar source. */
  calendarSource: (userId: string | undefined, source: string) =>
    ['events', 'calendar', userId ?? 'anon', 'list', source] as const,
  /** Phase B: one get_user_calendar call per range and source set. */
  calendarRange: (userId: string | undefined, fromIso: string, toIso: string, sources: string) =>
    ['events', 'calendar', userId ?? 'anon', 'range', fromIso, toIso, sources] as const,
  /** Prefix for every attendance-derived list (joined tabs + saved + calendar). */
  attendanceLists: () => ['events'] as const,
  /**
   * Full details of one event, as last shown on its page. Kept on the device
   * (most recent PERSIST_LIMITS.eventDetails) so events open offline.
   */
  eventDetails: (eventId: string) => ['event', 'details', eventId] as const,
  eventDetailsPrefix: () => ['event', 'details'] as const,
  /**
   * Profile tab: created + upcoming previews and the stat counts. Under the
   * 'events' prefix so RSVP / save changes (attendanceLists) refresh it.
   */
  /** Notifications tab: first page + unread count, kept on the device. */
  notifications: (userId: string) => ['notifications', userId] as const,
  notificationsPrefix: () => ['notifications'] as const,
  /** Another user's profile page (own = the viewer's own, full profile). */
  userProfile: (userId: string, own: boolean) => ['user-profile', userId, own ? 'own' : 'public'] as const,
  /** A business page: business, photos, links, upcoming events, reviews. */
  businessPage: (businessId: string) => ['business-page', businessId] as const,
  /** Host's own events for one My Events tab (paged). */
  myEvents: (businessId: string, scope: string) => ['events', 'mine', businessId, scope] as const,
  /** A chat room's newest messages + access state, kept for offline reading. */
  chatRoom: (eventId: string) => ['chat', 'room', eventId] as const,
  chatRoomPrefix: () => ['chat', 'room'] as const,
  /** Active promo banners for one placement. */
  banners: (placement: string) => ['banners', placement] as const,
  /** All event categories (hooks/useCategories). */
  categories: () => ['categories'] as const,
  /** Discover's last unfiltered area (utils/discoverSnapshot), kept on the device. */
  discoverLastArea: () => ['discover', 'last-area'] as const,
  profileOverview: (userId: string | undefined, businessId: string | undefined) =>
    ['events', 'profile', userId ?? 'anon', businessId ?? 'none'] as const,
};
