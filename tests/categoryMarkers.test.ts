import { describe, it, expect } from 'vitest';
import {
  CATEGORY_MARKER_PATHS,
  DEFAULT_MARKER_PATHS,
  MARKER_SIZE,
  buildCategoryMarkerSvg,
  markerColorForSlug,
  markerPathsForSlug,
  markerSvgScript,
} from '@/constants/categoryMarkers';
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR } from '@/constants/categories';
import { CATEGORY_ICON_CONFIG } from '@/constants/categoryIcons';

describe('marker path lookup', () => {
  it('resolves every configured category to its own glyph', () => {
    for (const slug of Object.keys(CATEGORY_MARKER_PATHS)) {
      expect(markerPathsForSlug(slug), slug).toBe(CATEGORY_MARKER_PATHS[slug]);
    }
  });

  it('maps the coffee aliases onto one glyph', () => {
    expect(markerPathsForSlug('cafe')).toBe(CATEGORY_MARKER_PATHS.coffee);
    expect(markerPathsForSlug('food-drink')).toBe(CATEGORY_MARKER_PATHS.coffee);
  });

  it('falls back to the pin for unknown, null or empty slugs', () => {
    expect(markerPathsForSlug('no-such-category')).toBe(DEFAULT_MARKER_PATHS);
    expect(markerPathsForSlug(null)).toBe(DEFAULT_MARKER_PATHS);
    expect(markerPathsForSlug(undefined)).toBe(DEFAULT_MARKER_PATHS);
    expect(markerPathsForSlug('')).toBe(DEFAULT_MARKER_PATHS);
  });

  it('colours each category from the shared palette', () => {
    expect(markerColorForSlug('nightlife')).toBe(CATEGORY_COLORS.nightlife);
    expect(markerColorForSlug('food-drink')).toBe(CATEGORY_COLORS.coffee);
    expect(markerColorForSlug('no-such-category')).toBe(DEFAULT_CATEGORY_COLOR);
    expect(markerColorForSlug(null)).toBe(DEFAULT_CATEGORY_COLOR);
  });

  it('covers every category that has an in-app icon', () => {
    // Drift guard: a category with a CategoryIcon but no marker glyph renders
    // as a generic grey pin on the map. This caught the business-category
    // labels ('Restaurant', 'Bar & Nightlife', …) that BusinessDetail passes
    // through as a marker categorySlug.
    const missing = Object.keys(CATEGORY_ICON_CONFIG).filter(
      (slug) => markerPathsForSlug(slug) === DEFAULT_MARKER_PATHS
    );
    expect(missing).toEqual([]);
  });

  it('gives every icon-config category the same colour on the map as in the UI', () => {
    // The pin must not be a different colour from the CategoryIcon shown
    // alongside it for the same category.
    for (const [slug, config] of Object.entries(CATEGORY_ICON_CONFIG)) {
      expect(markerColorForSlug(slug), slug).toBe(config.color);
    }
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
