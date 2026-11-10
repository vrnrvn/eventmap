/**
 * Remembers the category a business last published with, so Create can
 * pre-select it (docs/CATEGORIES_AND_SERIES_PLAN.md §3.4). Per business,
 * device-local, best effort: a storage failure just means no default.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export function lastCategoryKey(businessId: string): string {
  return `eventmap:last-category:${businessId}`;
}

export async function readLastCategory(businessId: string | null | undefined): Promise<string | null> {
  if (!businessId) return null;
  try {
    const v = await AsyncStorage.getItem(lastCategoryKey(businessId));
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function rememberLastCategory(businessId: string | null | undefined, categoryId: string): void {
  if (!businessId || !categoryId) return;
  AsyncStorage.setItem(lastCategoryKey(businessId), categoryId).catch(() => {});
}
