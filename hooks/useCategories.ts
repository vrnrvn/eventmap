import { useQuery } from '@tanstack/react-query';
import { categoriesService } from '@/services/categories';
import { queryKeys } from '@/hooks/queryKeys';
import { PERSISTED_QUERY } from '@/utils/queryPersistence';
import type { Category } from '@/types/database';

/**
 * Event categories, shared by Discover and the event forms. They change
 * rarely, so they're considered fresh for a day and kept on the device: the
 * filter chips and the category picker work offline (docs/OFFLINE_PLAN.md
 * §3.5). There's no bundled fallback list — filtering needs the database ids.
 */
export function useCategories() {
  const query = useQuery({
    queryKey: queryKeys.categories(),
    ...PERSISTED_QUERY,
    queryFn: () => categoriesService.getAllCategories(),
    staleTime: 24 * 60 * 60 * 1000,
  });
  return { ...query, categories: query.data ?? EMPTY };
}

const EMPTY: Category[] = [];
