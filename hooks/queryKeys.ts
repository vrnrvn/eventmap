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
};
