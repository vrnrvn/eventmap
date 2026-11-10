import { describe, it, expect } from 'vitest';
import {
  formatSynonyms,
  hasErrors,
  normalizeHex,
  parseSynonyms,
  readCategoryForm,
  slugify,
  whiteContrast,
} from '../admin/lib/categoryForm';
import { CATEGORY_ICON_PATHS as ADMIN_ICON_PATHS } from '../admin/lib/categoryIcons';
import { categoryIconPathTable } from '@/constants/categoryIconRegistry';
import { CATEGORY_SEED } from '@/constants/categorySeed';

/** Minimal FormData stand-in for node. */
const form = (fields: Record<string, string | undefined>) => ({
  get: (k: string) => (fields[k] === undefined ? null : fields[k]) as FormDataEntryValue | null,
});
const ICONS = Object.keys(ADMIN_ICON_PATHS);

describe('admin icon table', () => {
  it('matches the app registry exactly (no drift between admin previews and app pins)', () => {
    expect(ADMIN_ICON_PATHS).toEqual(categoryIconPathTable());
  });
  it('covers every seeded icon_key', () => {
    for (const c of CATEGORY_SEED) expect(ICONS, c.slug).toContain(c.icon_key);
  });
});

describe('slugify / synonyms / hex', () => {
  it('slugifies like the app expects', () => {
    expect(slugify('Live Music!')).toBe('live-music');
    expect(slugify('  Arts & Culture ')).toBe('arts-and-culture');
    expect(slugify('Café Nights')).toBe('cafe-nights');
    expect(slugify('---')).toBe('');
  });
  it('parses and formats synonyms', () => {
    expect(parseSynonyms('Gig, concert,\n band , gig,, ')).toEqual(['gig', 'concert', 'band']);
    expect(parseSynonyms('open   mic')).toEqual(['open mic']);
    expect(formatSynonyms(['a', 'b'])).toBe('a, b');
    expect(formatSynonyms(null)).toBe('');
  });
  it('normalises hex colours', () => {
    expect(normalizeHex('#1D4ED8')).toBe('#1d4ed8');
    expect(normalizeHex('1d4ed8')).toBe('#1d4ed8');
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('blue')).toBeNull();
  });
  it('computes white-text contrast consistent with the seed palette', () => {
    for (const c of CATEGORY_SEED) expect(whiteContrast(c.color), c.slug).toBeGreaterThanOrEqual(4.5);
    expect(whiteContrast('#ffffff')).toBeCloseTo(1, 5);
    expect(whiteContrast('#000000')).toBeCloseTo(21, 5);
  });
});

describe('readCategoryForm', () => {
  const good = {
    label: 'Comedy',
    slug: '',
    description: 'Stand-up and improv',
    icon_key: 'mic-vocal',
    color: '#7E22CE',
    synonyms: 'stand-up, improv, comedy',
    is_active: 'on',
  };

  it('accepts a valid form and derives the slug from the label', () => {
    const { value, errors } = readCategoryForm(form(good), ICONS);
    expect(hasErrors(errors)).toBe(false);
    expect(value.slug).toBe('comedy');
    expect(value.color).toBe('#7e22ce');
    expect(value.synonyms).toEqual(['stand-up', 'improv', 'comedy']);
    expect(value.is_active).toBe(true);
  });

  it('flags each invalid field', () => {
    const { errors } = readCategoryForm(
      form({ ...good, label: '', slug: 'Bad Slug', icon_key: 'nope', color: 'red', description: 'x'.repeat(121) }),
      ICONS
    );
    expect(errors.label).toBeTruthy();
    expect(errors.slug).toMatch(/lower-case/);
    expect(errors.icon_key).toBeTruthy();
    expect(errors.color).toMatch(/hex/);
    expect(errors.description).toBeTruthy();
  });

  it('treats a missing checkbox as inactive and respects an explicit slug', () => {
    const { value, errors } = readCategoryForm(form({ ...good, slug: 'stand-up', is_active: undefined }), ICONS);
    expect(hasErrors(errors)).toBe(false);
    expect(value.slug).toBe('stand-up');
    expect(value.is_active).toBe(false);
  });

  it('rejects an unusable label-derived slug', () => {
    const { errors } = readCategoryForm(form({ ...good, label: '!!!' }), ICONS);
    expect(errors.slug).toBeTruthy();
  });
});
