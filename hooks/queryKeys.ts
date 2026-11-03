/**
 * Query keys for the list screens on React Query. Keep them here so screens
 * that change the underlying data (EventDetail RSVP / save) can invalidate
 * exactly the lists that depend on it.
 */
export const queryKeys = {
  savedEvents: () => ['events', 'saved'] as const,
  joinedEvents: (userId: string | undefined, scope: string) =>
    ['events', 'joined', userId ?? 'anon', scope] as const,
  /** Prefix for every attendance-derived list (joined tabs + saved). */
  attendanceLists: () => ['events'] as const,
};
