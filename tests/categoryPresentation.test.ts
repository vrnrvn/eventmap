import { describe, it, expect } from 'vitest';
import { CATEGORY_SEED, CATEGORY_SLUG_ALIASES, LEGACY_CATEGORY_LABELS } from '@/constants/categorySeed';
import {
  CATEGORY_ICON_REGISTRY,
  DEFAULT_CATEGORY_ICON,
  getCategoryIconEntry,
} from '@/constants/categoryIconRegistry';
import { BUSINESS_CATEGORIES } from '@/constants/businessCategories';
import {
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_CATEGORY_LABEL,
  categoryTint,
  getCategoryColor,
  orderCategoriesForViewer,
  presentCategory,
  resolveCategorySlug,
} from '@/utils/categoryPresentation';

/** WCAG relative luminance / contrast, kept local so this suite is standalone. */
function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('category seed', () => {
  it('has unique slugs and contiguous sort order', () => {
    const slugs = CATEGORY_SEED.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(CATEGORY_SEED.map((c) => c.sort_order)).toEqual(CATEGORY_SEED.map((_, i) => i + 1));
  });

  it('resolves every icon_key in the registry (no silent pin fallback)', () => {
    for (const c of CATEGORY_SEED) {
      expect(getCategoryIconEntry(c.icon_key), c.slug).not.toBe(DEFAULT_CATEGORY_ICON);
    }
    for (const b of BUSINESS_CATEGORIES) {
      if (b.iconKey) expect(CATEGORY_ICON_REGISTRY[b.iconKey], b.label).toBeDefined();
    }
  });

  it('keeps white text readable on every category colour (WCAG AA 4.5:1)', () => {
    // Selected chips and badges fill with the colour and use white text/glyphs.
    for (const c of CATEGORY_SEED) {
      expect(contrast(c.color, '#FFFFFF'), `${c.slug} ${c.color}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const b of BUSINESS_CATEGORIES) {
      expect(contrast(b.color, '#FFFFFF'), `${b.label} ${b.color}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every registry glyph has at least one path and no stray quotes', () => {
    for (const [key, entry] of Object.entries(CATEGORY_ICON_REGISTRY)) {
      expect(entry.paths.length, key).toBeGreaterThan(0);
      for (const d of entry.paths) expect(d, key).not.toMatch(/["<>]/);
    }
  });

  it('aliases and legacy labels point at seeded slugs', () => {
    const slugs = new Set(CATEGORY_SEED.map((c) => c.slug));
    for (const target of Object.values(CATEGORY_SLUG_ALIASES)) expect(slugs.has(target), target).toBe(true);
    for (const target of Object.values(LEGACY_CATEGORY_LABELS)) expect(slugs.has(target), target).toBe(true);
  });
});

describe('resolveCategorySlug', () => {
  it('accepts slugs, aliases, current labels and pre-migration labels', () => {
    expect(resolveCategorySlug('live-music')).toBe('live-music');
    expect(resolveCategorySlug('cafe')).toBe('food-drink');
    expect(resolveCategorySlug('coffee')).toBe('food-drink');
    expect(resolveCategorySlug('Live Music')).toBe('live-music');
    expect(resolveCategorySlug('DJ Nights & Nightlife')).toBe('nightlife');
    expect(resolveCategorySlug('Food & Dining')).toBe('dining');
  });

  it('returns null for unknown, empty or business labels', () => {
    expect(resolveCategorySlug('Restaurant')).toBeNull();
    expect(resolveCategorySlug('')).toBeNull();
    expect(resolveCategorySlug(null)).toBeNull();
    expect(resolveCategorySlug('no-such')).toBeNull();
  });
});

describe('presentCategory', () => {
  const seed = CATEGORY_SEED.find((c) => c.slug === 'live-music')!;

  it('prefers the database row when it carries a colour', () => {
    const row = {
      slug: 'live-music',
      label: 'Gigs',
      color: '#123456',
      icon_key: 'dices',
      description: 'custom',
    };
    const p = presentCategory(row);
    expect(p.label).toBe('Gigs');
    expect(p.color).toBe('#123456');
    expect(p.iconKey).toBe('dices');
    expect(p.paths).toBe(CATEGORY_ICON_REGISTRY.dices.paths);
    expect(p.description).toBe('custom');
  });

  it('presents a pre-migration row (no colour) from the seed by slug', () => {
    const p = presentCategory({ slug: 'nightlife', label: 'DJ Nights & Nightlife', icon_key: 'music' });
    const s = CATEGORY_SEED.find((c) => c.slug === 'nightlife')!;
    expect(p.label).toBe(s.label);
    expect(p.color).toBe(s.color);
    expect(p.iconKey).toBe(s.icon_key);
  });

  it('falls back to the seed icon when a row has an unknown icon_key', () => {
    const p = presentCategory({ slug: 'live-music', label: 'Live Music', color: '#1d4ed8', icon_key: 'not-an-icon' });
    expect(p.iconKey).toBe(seed.icon_key);
    expect(p.paths).toBe(CATEGORY_ICON_REGISTRY[seed.icon_key].paths);
  });

  it('presents slugs, aliases and business labels from the bundled tables', () => {
    expect(presentCategory('live-music').color).toBe(seed.color);
    expect(presentCategory('cafe').iconKey).toBe('coffee');
    const biz = presentCategory('Restaurant');
    expect(biz.slug).toBeNull();
    expect(biz.iconKey).toBe('utensils-crossed');
    expect(biz.label).toBe('Restaurant');
  });

  it('uses a neutral pin for unknown input and keeps the given text as label', () => {
    const p = presentCategory('Mystery');
    expect(p.color).toBe(DEFAULT_CATEGORY_COLOR);
    expect(p.paths).toBe(DEFAULT_CATEGORY_ICON.paths);
    expect(p.label).toBe('Mystery');
    expect(presentCategory(null).label).toBe(DEFAULT_CATEGORY_LABEL);
    expect(presentCategory(undefined).color).toBe(DEFAULT_CATEGORY_COLOR);
    expect(getCategoryColor('')).toBe(DEFAULT_CATEGORY_COLOR);
  });

  it('ignores malformed colours on a row', () => {
    const p = presentCategory({ slug: 'sports', label: 'Sports', color: 'green', icon_key: 'trophy' });
    expect(p.color).toBe(CATEGORY_SEED.find((c) => c.slug === 'sports')!.color);
  });
});

describe('categoryTint', () => {
  it('appends an alpha byte to hex colours and leaves others alone', () => {
    expect(categoryTint('#1d4ed8', 0.1)).toBe('#1d4ed81a');
    expect(categoryTint('#1d4ed8', 1)).toBe('#1d4ed8ff');
    expect(categoryTint('rgba(0,0,0,0.5)', 0.1)).toBe('rgba(0,0,0,0.5)');
  });
});

describe('orderCategoriesForViewer', () => {
  const cats = [
    { id: 'a', sort_order: 1, is_active: true },
    { id: 'b', sort_order: 2, is_active: true },
    { id: 'c', sort_order: 3, is_active: false },
    { id: 'd', sort_order: 4, is_active: true },
  ];

  it('puts preferred first in stored order, then the rest by sort_order', () => {
    expect(orderCategoriesForViewer(cats, ['d', 'b']).map((c) => c.id)).toEqual(['d', 'b', 'a']);
  });

  it('hides retired categories unless preferred, and ignores unknown ids', () => {
    expect(orderCategoriesForViewer(cats, null).map((c) => c.id)).toEqual(['a', 'b', 'd']);
    expect(orderCategoriesForViewer(cats, ['c', 'zzz']).map((c) => c.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('does not mutate the input', () => {
    const copy = cats.slice();
    orderCategoriesForViewer(cats, ['d']);
    expect(cats).toEqual(copy);
  });
});
