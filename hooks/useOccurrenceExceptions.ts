import { useQuery } from '@tanstack/react-query';
import { occurrencesService } from '@/services/occurrences';
import { queryKeys } from '@/hooks/queryKeys';
import type { OccurrenceException } from '@/utils/occurrences';

const EMPTY: OccurrenceException[] = [];

/** Exceptions for a series; [] for one-offs, while loading, or pre-migration. */
export function useOccurrenceExceptions(eventId: string | undefined, isRecurring: boolean) {
  const query = useQuery({
    queryKey: queryKeys.occurrenceExceptions(eventId ?? 'none'),
    enabled: !!eventId && isRecurring,
    queryFn: () => occurrencesService.listExceptions(eventId!),
    staleTime: 60 * 1000,
  });
  return { ...query, exceptions: query.data ?? EMPTY };
}
