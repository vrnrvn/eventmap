/**
 * React Query hooks for private event collections
 * (docs/EVENT_COLLECTIONS_PLAN.md §3.3). Both lists are persisted so the
 * collections home and a collection's first page open offline after a
 * restart, like Saved Events. Keys live under ['events'], so RSVP / save
 * writes (which change smart collections) mark them stale and the screens
 * catch up on focus.
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { queryKeys } from '@/hooks/queryKeys';
import { useRefetchOnFocus } from '@/hooks/useRefetchOnFocus';
import { CollectionsUnavailableError, collectionsService } from '@/services/collections';
import { getPendingWrites, subscribePendingWrites } from '@/services/pendingWrites';
import { profilesService } from '@/services/profiles';
import { parseCollectionItemTarget } from '@/utils/collections';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import type { Collection, CollectionFilter, CollectionSort } from '@/types/database';

export const COLLECTION_PAGE_SIZE = 30;

/** The signed-in user's collections, refreshed when the screen regains focus. */
export function useCollectionsList() {
  const { user } = useAuth();
  const userId = user?.id;
  const query = useQuery({
    queryKey: queryKeys.collections(userId),
    ...PERSISTED_QUERY,
    enabled: !!userId,
    queryFn: () => collectionsService.list(),
    staleTime: 30_000,
  });
  useRefetchOnFocus(query.refetch, !!userId, queryKeys.collections(userId));
  return query;
}

/** One collection's events for a sort / filter pair, paged. */
export function useCollectionEvents(collectionId: string | undefined, sort: CollectionSort, filter: CollectionFilter) {
  const { user } = useAuth();
  const userId = user?.id;
  const enabled = !!userId && !!collectionId;
  const key = queryKeys.collectionEvents(userId, collectionId ?? 'none', sort, filter);
  const query = useInfiniteQuery({
    queryKey: key,
    ...PERSISTED_QUERY,
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      collectionsService.events(collectionId!, { limit: COLLECTION_PAGE_SIZE, offset: pageParam, sort, filter }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= COLLECTION_PAGE_SIZE ? allPages.reduce((n, page) => n + page.length, 0) : undefined,
  });
  useRefetchOnFocus(query.refetch, enabled, key);
  return query;
}

/**
 * Invalidation after a collection write: the home list (counts, covers,
 * order) and, when given, every sort / filter page of one collection. Marks
 * stale without refetching hidden screens; the visible one refetches now.
 */
export function useInvalidateCollections() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  return useCallback(
    (collectionId?: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.collections(userId) });
      if (collectionId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.collectionEventsPrefix(userId, collectionId) });
      }
    },
    [queryClient, userId]
  );
}

/**
 * Queued (offline) pin / unpin intents for one event: collection id → `on`.
 * Lets the add-to-collection sheet show "will sync" per row and keep the
 * user's intent visible even if the server membership is refetched first.
 */
export function usePendingCollectionItems(eventId: string | null | undefined): Map<string, boolean> {
  const compute = useCallback(() => {
    const out = new Map<string, boolean>();
    if (!eventId) return out;
    for (const w of getPendingWrites()) {
      if (w.kind !== 'collectionItem') continue;
      const pair = parseCollectionItemTarget(w.targetId);
      if (pair?.eventId === eventId) out.set(pair.collectionId, w.on);
    }
    return out;
  }, [eventId]);
  const [pending, setPending] = useState(compute);
  useEffect(() => {
    setPending(compute());
    return subscribePendingWrites(() => setPending(compute()));
  }, [compute]);
  return pending;
}

/**
 * Favourited event types = the viewer's single-category smart collections
 * (docs/EVENT_COLLECTIONS_PLAN.md Phase D). `favourite` creates the smart
 * collection (or finds it after a lost response) and returns its id;
 * `unfavourite` deletes it, pins included. Both are online-only writes and
 * refresh the collections list afterwards. `inFlight` holds category ids
 * with a pending toggle so buttons can show busy state.
 */
export function useFavouriteCategories() {
  const query = useCollectionsList();
  const invalidate = useInvalidateCollections();
  const { user, profile, refreshProfile } = useAuth();
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set());
  const byCategory = useMemo(() => {
    const map = new Map<string, Collection>();
    for (const c of query.data ?? []) {
      if (c.kind === 'smart' && c.category_ids.length === 1) map.set(c.category_ids[0], c);
    }
    return map;
  }, [query.data]);

  const track = useCallback(async <T,>(categoryId: string, work: () => Promise<T>): Promise<T> => {
    setInFlight((prev) => new Set(prev).add(categoryId));
    try {
      return await work();
    } finally {
      setInFlight((prev) => {
        const next = new Set(prev);
        next.delete(categoryId);
        return next;
      });
      invalidate();
    }
  }, [invalidate]);

  const favourite = useCallback(
    (categoryId: string) =>
      track(categoryId, async () => {
        const id = await collectionsService.favouriteCategory(categoryId);
        // A favourited type is also an interest (docs §7, decision (a)): it
        // then boosts Discover and qualifies for the interest notification.
        // Unfavouriting does not remove the interest; interests are broader.
        if (user && profile && !(profile.preferred_categories ?? []).includes(categoryId)) {
          try {
            await profilesService.updateProfile(user.id, {
              preferred_categories: [...(profile.preferred_categories ?? []), categoryId],
            });
            void refreshProfile();
          } catch {
            // Best effort: the collection exists either way.
          }
        }
        return id;
      }),
    [track, user, profile, refreshProfile]
  );
  const unfavourite = useCallback(
    (categoryId: string) => track(categoryId, () => collectionsService.unfavouriteCategory(categoryId)),
    [track]
  );

  return {
    byCategory,
    isFavourite: (categoryId: string) => byCategory.has(categoryId),
    favourite,
    unfavourite,
    inFlight,
    isLoading: query.isPending,
    unavailable: query.error instanceof CollectionsUnavailableError,
  };
}
