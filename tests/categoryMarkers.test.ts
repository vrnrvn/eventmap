import { describe, it, expect } from 'vitest';
import {
  CATEGORY_ICON_PATHS,
  CATEGORY_SLUG_STYLES,
  DEFAULT_MARKER_PATHS,
  MARKER_SIZE,
  buildCategoryMarkerSvg,
  markerColorForSlug,
  markerPathsForSlug,
  markerSvgScript,
  resolveMarkerStyle,
} from '@/constants/categoryMarkers';
import { CATEGORY_SEED } from '@/constants/categorySeed';
import { BUSINESS_CATEGORIES } from '@/constants/businessCategories';
import { DEFAULT_CATEGORY_COLOR, presentCategory } from '@/utils/categoryPresentation';

/** slug → colour for the seeded taxonomy (what the old CATEGORY_COLORS was). */
const CATEGORY_COLORS: Record<string, string> = Object.fromEntries(
  CATEGORY_SEED.map((c) => [c.slug, c.color])
);
/** slug → glyph paths for every seeded category. */
const CATEGORY_MARKER_PATHS: Record<string, readonly string[]> = Object.fromEntries(
  CATEGORY_SEED.map((c) => [c.slug, CATEGORY_ICON_PATHS[c.icon_key]])
);

describe('marker path lookup', () => {
  it('resolves every seeded category to its own glyph', () => {
    for (const slug of Object.keys(CATEGORY_MARKER_PATHS)) {
      expect(markerPathsForSlug(slug), slug).toBe(CATEGORY_MARKER_PATHS[slug]);
    }
  });

  it('maps the coffee aliases onto the drinks glyph', () => {
    expect(markerPathsForSlug('cafe')).toBe(CATEGORY_ICON_PATHS.coffee);
    expect(markerPathsForSlug('coffee')).toBe(CATEGORY_ICON_PATHS.coffee);
    expect(markerPathsForSlug('food-drink')).toBe(CATEGORY_ICON_PATHS.coffee);
  });

  it('styles a marker from its own colour and icon key when provided', () => {
    // Discover passes the category row's colour/icon so pins follow the
    // database; the slug is only the fallback.
    const style = resolveMarkerStyle({ categorySlug: 'sports', categoryColor: '#123456', categoryIconKey: 'dices' });
    expect(style.color).toBe('#123456');
    expect(style.paths).toBe(CATEGORY_ICON_PATHS.dices);
  });

  it('falls back to the slug when the explicit style is missing or invalid', () => {
    const style = resolveMarkerStyle({ categorySlug: 'sports', categoryColor: 'green', categoryIconKey: 'nope' });
    expect(style.color).toBe(CATEGORY_COLORS.sports);
    expect(style.paths).toBe(CATEGORY_MARKER_PATHS.sports);
    expect(resolveMarkerStyle({}).paths).toBe(DEFAULT_MARKER_PATHS);
  });

  it('falls back to the pin for unknown, null or empty slugs', () => {
    expect(markerPathsForSlug('no-such-category')).toBe(DEFAULT_MARKER_PATHS);
    expect(markerPathsForSlug(null)).toBe(DEFAULT_MARKER_PATHS);
    expect(markerPathsForSlug(undefined)).toBe(DEFAULT_MARKER_PATHS);
    expect(markerPathsForSlug('')).toBe(DEFAULT_MARKER_PATHS);
  });

  it('colours each category from the shared palette', () => {
    expect(markerColorForSlug('nightlife')).toBe(CATEGORY_COLORS.nightlife);
    expect(markerColorForSlug('cafe')).toBe(CATEGORY_COLORS['food-drink']);
    expect(markerColorForSlug('no-such-category')).toBe(DEFAULT_CATEGORY_COLOR);
    expect(markerColorForSlug(null)).toBe(DEFAULT_CATEGORY_COLOR);
  });

  it('covers every category and business label that has an in-app icon', () => {
    // Drift guard: a category with a CategoryIcon but no marker glyph renders
    // as a generic grey pin on the map. Business labels ('Restaurant', …) are
    // passed straight through by BusinessDetail as a marker categorySlug.
    const inputs = [
      ...CATEGORY_SEED.map((c) => c.slug),
      ...BUSINESS_CATEGORIES.filter((b) => b.iconKey).map((b) => b.label),
    ];
    const missing = inputs.filter((slug) => markerPathsForSlug(slug) === DEFAULT_MARKER_PATHS);
    expect(missing).toEqual([]);
  });

  it('gives every category the same colour and glyph on the map as in the UI', () => {
    // The pin must not differ from the CategoryIcon shown alongside it.
    for (const input of [...CATEGORY_SEED.map((c) => c.slug), ...BUSINESS_CATEGORIES.map((b) => b.label), 'cafe']) {
      const ui = presentCategory(input);
      expect(markerColorForSlug(input), input).toBe(ui.color);
      expect(markerPathsForSlug(input), input).toBe(ui.paths);
    }
  });

  it('exposes a slug table the WebView can use without the React registry', () => {
    for (const c of CATEGORY_SEED) {
      expect(CATEGORY_SLUG_STYLES[c.slug]).toEqual({ color: c.color, iconKey: c.icon_key });
    }
    expect(CATEGORY_SLUG_STYLES.cafe).toEqual(CATEGORY_SLUG_STYLES['food-drink']);
  });
});

describe('buildCategoryMarkerSvg', () => {
  it('renders at the 44pt touch-target size', () => {
    expect(MARKER_SIZE).toBeGreaterThanOrEqual(44);
    const svg = buildCategoryMarkerSvg('dining', false);
    expect(svg).toContain(`width="${MARKER_SIZE}"`);
    expect(svg).toContain(`height="${MARKER_SIZE}"`);
    expect(svg).toContain(`viewBox="0 0 ${MARKER_SIZE} ${MARKER_SIZE}"`);
  });

  it('keeps the visible disc centred and at its original size', () => {
    // Padding (not a bigger disc) is what lifts the tap target, so the map
    // does not become visually heavier.
    const svg = buildCategoryMarkerSvg('dining', false);
    expect(svg).toContain(`cx="${MARKER_SIZE / 2}" cy="${MARKER_SIZE / 2}" r="14"`);
  });

  it('uses the category colour', () => {
    expect(buildCategoryMarkerSvg('nightlife', false)).toContain(CATEGORY_COLORS.nightlife);
    expect(buildCategoryMarkerSvg('sports', false)).toContain(CATEGORY_COLORS.sports);
  });

  it('distinguishes the active state', () => {
    const idle = buildCategoryMarkerSvg('dining', false);
    const active = buildCategoryMarkerSvg('dining', true);
    expect(idle).not.toBe(active);
    expect(active).toContain('stroke="#1a1a1a"');
    expect(idle).toContain('rgba(0,0,0,0.35)');
  });

  it('emits one path element per glyph segment', () => {
    for (const [slug, paths] of Object.entries(CATEGORY_MARKER_PATHS)) {
      const svg = buildCategoryMarkerSvg(slug, false);
      // +0 for the disc, which is a <circle> not a <path>.
      expect(svg.match(/<path /g)?.length ?? 0, slug).toBe(paths.length);
    }
  });

  it('produces well-formed SVG for every category', () => {
    for (const slug of [...Object.keys(CATEGORY_MARKER_PATHS), 'unknown']) {
      const svg = buildCategoryMarkerSvg(slug, false);
      expect(svg.startsWith('<svg'), slug).toBe(true);
      expect(svg.endsWith('</svg>'), slug).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      // Unbalanced quotes would break the data: URI and the divIcon alike.
      expect((svg.match(/"/g)?.length ?? 0) % 2, slug).toBe(0);
    }
  });
});

describe('markerSvgScript (in-WebView builder)', () => {
  /** Evaluate the emitted source and hand back its __markerSvg. */
  function loadScript(): (slug: string | null, active: boolean) => string {
    return new Function(`${markerSvgScript()}; return __markerSvg;`)() as (
      s: string | null,
      a: boolean
    ) => string;
  }

  it('is valid JavaScript', () => {
    expect(() => loadScript()).not.toThrow();
  });

  it('matches the TypeScript builder exactly for every category', () => {
    // This is the whole point of sharing: the two renderers must not drift.
    const markerSvg = loadScript();
    for (const slug of [...Object.keys(CATEGORY_MARKER_PATHS), 'cafe', 'food-drink', 'unknown']) {
      for (const active of [false, true]) {
        expect(markerSvg(slug, active), `${slug} active=${active}`).toBe(
          buildCategoryMarkerSvg(slug, active)
        );
      }
    }
  });

  it('matches the TypeScript builder for marker objects (row colour + icon key)', () => {
    const markerSvg = loadScript() as unknown as (m: object, a: boolean) => string;
    const cases = [
      { categorySlug: 'sports', categoryColor: '#123456', categoryIconKey: 'dices' },
      { categorySlug: 'sports', categoryColor: 'green', categoryIconKey: 'nope' },
      { categorySlug: '', categoryColor: '#abcdef', categoryIconKey: 'users' },
      { categorySlug: 'unknown', categoryColor: '', categoryIconKey: '' },
      {},
    ];
    for (const m of cases) {
      for (const active of [false, true]) {
        expect(markerSvg(m, active), JSON.stringify(m)).toBe(buildCategoryMarkerSvg(m, active));
      }
    }
  });

  it('matches for null and empty slugs too', () => {
    const markerSvg = loadScript();
    expect(markerSvg(null, false)).toBe(buildCategoryMarkerSvg(null, false));
    expect(markerSvg('', false)).toBe(buildCategoryMarkerSvg('', false));
  });

  it('contains no unescaped script terminator', () => {
    // The source is injected into an inline <script> block in both templates.
    expect(markerSvgScript().toLowerCase()).not.toContain('</script');
  });
});

import { dominantMarkerColor } from '@/constants/categoryMarkers';

describe('cluster colour (dominant category)', () => {
  const loadDominant = () =>
    new Function(`${markerSvgScript()}; return __markerDominantColor;`)() as (inputs: unknown[]) => string;

  it('picks the most common colour, first seen on ties, default when empty', () => {
    expect(dominantMarkerColor(['sports', 'live-music', 'live-music'])).toBe(CATEGORY_COLORS['live-music']);
    expect(dominantMarkerColor(['sports', 'live-music'])).toBe(CATEGORY_COLORS.sports);
    expect(dominantMarkerColor([])).toBe(DEFAULT_CATEGORY_COLOR);
    expect(dominantMarkerColor([{ categoryColor: '#123456' }, { categoryColor: '#123456' }, 'sports'])).toBe('#123456');
  });

  it('WebView copy agrees with the TypeScript one', () => {
    const js = loadDominant();
    const cases: unknown[][] = [
      ['sports', 'live-music', 'live-music'],
      ['sports', 'live-music'],
      [],
      [{ categorySlug: 'sports', categoryColor: '#123456' }, { categorySlug: 'cafe' }, { categorySlug: 'cafe' }],
      [null, 'unknown'],
    ];
    for (const c of cases) expect(js(c), JSON.stringify(c)).toBe(dominantMarkerColor(c as never));
  });
});
