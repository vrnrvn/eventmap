import { describe, it, expect } from 'vitest';
import {
  categoryRoute,
  findCategoryBySlug,
  getCategoryWebUrl,
  matchCategorySuggestions,
} from '@/utils/categoryBrowse';
import { CATEGORY_SEED } from '@/constants/categorySeed';

const rows = CATEGORY_SEED.map((c, i) => ({ ...c, id: `id-${i}`, created_at: '' }));
/** Rows as a pre-migration database returns them: old labels, no synonyms. */
const legacyRows = rows.map(({ synonyms: _s, color: _c, ...r }) => ({
  ...r,
  label: r.slug === 'live-music' ? 'Live Music' : r.label,
}));

describe('findCategoryBySlug', () => {
  it('matches slugs case-insensitively, decoded, and from array params', () => {
    expect(findCategoryBySlug(rows, 'live-music')?.slug).toBe('live-music');
    expect(findCategoryBySlug(rows, 'LIVE-MUSIC')?.slug).toBe('live-music');
    expect(findCategoryBySlug(rows, ['food-drink'])?.slug).toBe('food-drink');
    expect(findCategoryBySlug(rows, encodeURIComponent('arts & culture'))?.slug).toBe('culture');
  });

  it('accepts historical aliases so old links keep working', () => {
    expect(findCategoryBySlug(rows, 'cafe')?.slug).toBe('food-drink');
  });

  it('returns null for unknown, empty or malformed input', () => {
    expect(findCategoryBySlug(rows, 'nope')).toBeNull();
    expect(findCategoryBySlug(rows, '')).toBeNull();
    expect(findCategoryBySlug(rows, undefined)).toBeNull();
    expect(findCategoryBySlug(rows, '%E0%A4%A')).toBeNull();
  });

  it('still resolves a retired category', () => {
    const retired = rows.map((r) => (r.slug === 'trivia' ? { ...r, is_active: false } : r));
    expect(findCategoryBySlug(retired, 'trivia')?.slug).toBe('trivia');
  });
});

describe('links', () => {
  it('builds an encoded route and a web URL on the configured origin', () => {
    expect(categoryRoute('live-music')).toBe('/category/live-music');
    expect(categoryRoute('a b')).toBe('/category/a%20b');
    expect(getCategoryWebUrl('live-music')).toMatch(/^https?:\/\/[^/]+\/category\/live-music$/);
  });
});

describe('matchCategorySuggestions', () => {
  const slugs = (q: string, list: Parameters<typeof matchCategorySuggestions>[1] = rows) => matchCategorySuggestions(q, list).map((s) => s.category.slug);

  it('suggests by label prefix, label word, then synonym', () => {
    expect(slugs('live')[0]).toBe('live-music');
    expect(slugs('music')[0]).toBe('live-music');
    expect(slugs('gig')).toEqual(['live-music']);
    expect(matchCategorySuggestions('gig', rows)[0].matched).toBe('gig');
  });

  it('handles case, accents, punctuation and plural-ish queries', () => {
    expect(slugs('  LIVE ')[0]).toBe('live-music');
    expect(slugs('café')).toContain('food-drink');
    expect(slugs('concerts')).toContain('live-music');
  });

  it('falls back to bundled synonyms when the row has none (pre-migration)', () => {
    expect(slugs('gig', legacyRows)).toEqual(['live-music']);
  });

  it('ignores very short queries, unmatched text and retired categories', () => {
    expect(slugs('m')).toEqual([]);
    expect(slugs('zzzz')).toEqual([]);
    const retired = rows.map((r) => (r.slug === 'live-music' ? { ...r, is_active: false } : r));
    expect(slugs('gig', retired)).toEqual([]);
  });

  it('caps the number of suggestions', () => {
    expect(matchCategorySuggestions('a', rows, 2).length).toBeLessThanOrEqual(2);
    expect(matchCategorySuggestions('ga', rows, 2).length).toBeLessThanOrEqual(2);
  });
});

import { suggestCategoryFromText } from '@/utils/categoryBrowse';

describe('suggestCategoryFromText', () => {
  const pick = (title: string, description = '') => suggestCategoryFromText(title, description, rows)?.slug ?? null;

  it('suggests from title words and synonyms', () => {
    expect(pick('Friday Night Gig at the Lantern')).toBe('live-music');
    expect(pick('Saturday Morning Yoga')).toBe('fitness');
    expect(pick('Pub Quiz')).toBe('trivia');
    expect(pick('Vintage flea market')).toBe('markets');
  });

  it('uses the description when the title is vague', () => {
    expect(pick('Sunday session', 'Three local bands and an open mic')).toBe('live-music');
  });

  it('handles plurals and case', () => {
    expect(pick('KIDS story hour')).toBe('family');
    expect(pick('Wine tastings')).toBe('food-drink');
  });

  it('returns null when nothing matches or two categories tie', () => {
    expect(pick('Hangout')).toBeNull();
    expect(pick('')).toBeNull();
    // "concert" (music) vs "yoga" (fitness), both in the title.
    expect(pick('Yoga concert')).toBeNull();
  });

  it('never matches a word inside another word', () => {
    // "run" must not fire on "brunch" (dining) — brunch wins on its own.
    expect(pick('Brunch')).toBe('dining');
  });

  it('skips retired categories', () => {
    const retired = rows.map((r) => (r.slug === 'live-music' ? { ...r, is_active: false } : r));
    expect(suggestCategoryFromText('Friday gig', '', retired)).toBeNull();
  });
});
