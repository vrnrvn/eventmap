import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { categoriesService } from '@/services/categories';
import { queryKeys } from '@/hooks/queryKeys';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import type { Category } from '@/types/database';

/**
 * Event categories, shared by Discover, the event forms and the interests
 * pickers. They change rarely, so they're considered fresh for a day and kept
 * on the device: the filter chips and the category picker work offline
 * (docs/OFFLINE_PLAN.md §3.5). There's no bundled fallback *list* — filtering
 * needs the database ids — but presentation (label/colour/icon) of a known
 * slug always works through utils/categoryPresentation.
 *
 * `categories` excludes retired rows (`is_active = false`); they are still in
 * `allCategories` and `byId` so events that use them keep rendering.
 */
export function useCategories() {
  const query = useQuery({
    queryKey: queryKeys.categories(),
    ...PERSISTED_QUERY,
    queryFn: () => categoriesService.getAllCategories(),
    staleTime: 24 * 60 * 60 * 1000,
  });
  const allCategories = query.data ?? EMPTY;
  const categories = useMemo(
    () => allCategories.filter((c) => c.is_active !== false),
    [allCategories]
  );
  const byId = useMemo(() => new Map(allCategories.map((c) => [c.id, c])), [allCategories]);
  return { ...query, categories, allCategories, byId };
}

const EMPTY: Category[] = [];
