/**
 * Pure helpers for category browsing (docs/CATEGORIES_AND_SERIES_PLAN.md
 * §3.3): slug → category lookup for `/category/[slug]`, shareable links, and
 * the "Category" suggestions shown in the search overlay. No React Native
 * imports, so all of it is unit-tested under node.
 */
import type { Category } from '@/types/database';
import { CATEGORY_SEED_BY_SLUG } from '@/constants/categorySeed';
import { presentCategory, resolveCategorySlug } from '@/utils/categoryPresentation';

type BrowseCategory = Pick<Category, 'id' | 'slug' | 'label'> &
  Partial<Pick<Category, 'synonyms' | 'is_active' | 'sort_order'>>;

/**
 * Find the category a `/category/[slug]` route refers to. Accepts the slug in
 * any case and the historical aliases ('cafe'), so old shared links keep
 * working. Retired categories still resolve (a link to one shows its events
 * rather than a dead end).
 */
export function findCategoryBySlug<T extends BrowseCategory>(
  categories: readonly T[],
  raw: string | string[] | null | undefined
): T | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Malformed escape: match the raw text instead.
  }
  const wanted = decoded.trim().toLowerCase();
  if (!wanted) return null;
  const direct = categories.find((c) => c.slug.toLowerCase() === wanted);
  if (direct) return direct;
  const resolved = resolveCategorySlug(wanted);
  return resolved ? categories.find((c) => c.slug === resolved) ?? null : null;
}

/** In-app route for a category's browse screen. */
export function categoryRoute(slug: string): string {
  return `/category/${encodeURIComponent(slug)}`;
}

/** Shareable web link; the app's linking config maps it to the same route. */
export function getCategoryWebUrl(slug: string): string {
  const base = (process.env.EXPO_PUBLIC_APP_WEB_ORIGIN ?? 'https://eventmap.pro').replace(/\/$/, '');
  return `${base}${categoryRoute(slug)}`;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type CategorySuggestion<T> = {
  category: T;
  /** What matched, for the row's secondary text ("matches “gig”"). */
  matched: string | null;
};

/**
 * Categories the search overlay suggests for what the user has typed.
 *
 * Ranking: label prefix (e.g. "liv" → Live Music) > a label word prefix
 * ("music") > a synonym prefix ("gig" → Live Music). Synonyms come from the
 * row (20261109100000) and fall back to the bundled seed, so suggestions work
 * before the migration is applied. Queries shorter than 2 characters suggest
 * nothing (one letter matches half the taxonomy). Retired categories are
 * never suggested.
 */
export function matchCategorySuggestions<T extends BrowseCategory>(
  query: string,
  categories: readonly T[],
  limit = 3
): CategorySuggestion<T>[] {
  const q = normalise(query);
  if (q.length < 2) return [];

  const scored: { category: T; score: number; matched: string | null; order: number }[] = [];
  for (const category of categories) {
    if (category.is_active === false) continue;
    const label = normalise(presentCategory(category).label);
    const synonyms = (category.synonyms?.length
      ? category.synonyms
      : CATEGORY_SEED_BY_SLUG[category.slug]?.synonyms ?? []
    ).map(normalise);

    let score = 0;
    let matched: string | null = null;
    if (label.startsWith(q)) score = 3;
    else if (label.split(' ').some((w) => w.startsWith(q))) score = 2;
    else {
      const syn = synonyms.find((s) => s.startsWith(q) || (q.length >= 3 && q.startsWith(s)));
      if (syn) {
        score = 1;
        matched = syn;
      }
    }
    if (score > 0) scored.push({ category, score, matched, order: category.sort_order ?? 0 });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ category, matched }) => ({ category, matched }));
}

/**
 * Category a host probably means, from the event title + description, for the
 * Create/Edit "Looks like Live Music — use it?" hint. Never auto-applied.
 *
 * Counts whole-word (or whole-phrase) hits of each category's label words and
 * synonyms; title hits weigh double. Returns null unless one category wins
 * outright — a tie means the text is ambiguous and a wrong nudge is worse
 * than none. Generic words shared by several categories are skipped.
 */
export function suggestCategoryFromText<T extends BrowseCategory>(
  title: string,
  description: string,
  categories: readonly T[]
): T | null {
  const t = ` ${normalise(title)} `;
  const d = ` ${normalise(description)} `;
  if (t.trim().length + d.trim().length < 3) return null;

  const termsFor = (c: T) => {
    const syn = c.synonyms?.length ? c.synonyms : CATEGORY_SEED_BY_SLUG[c.slug]?.synonyms ?? [];
    const labelWords = normalise(presentCategory(c).label)
      .split(' ')
      .filter((w) => w.length > 3 && w !== '&');
    return [...new Set([...syn.map(normalise), ...labelWords])].filter(Boolean);
  };
  const active = categories.filter((c) => c.is_active !== false);
  const termOwners = new Map<string, number>();
  const terms = active.map((c) => {
    const list = termsFor(c);
    for (const term of list) termOwners.set(term, (termOwners.get(term) ?? 0) + 1);
    return list;
  });

  let best: T | null = null;
  let bestScore = 0;
  let tie = false;
  active.forEach((c, i) => {
    let score = 0;
    for (const term of terms[i]) {
      if ((termOwners.get(term) ?? 0) > 1) continue;
      const needle = ` ${term} `;
      const plural = ` ${term}s `;
      if (t.includes(needle) || t.includes(plural)) score += 2;
      else if (d.includes(needle) || d.includes(plural)) score += 1;
    }
    if (score > bestScore) {
      best = c;
      bestScore = score;
      tie = false;
    } else if (score > 0 && score === bestScore) {
      tie = true;
    }
  });
  return tie ? null : best;
}
