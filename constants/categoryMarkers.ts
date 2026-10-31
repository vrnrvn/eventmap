import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR } from './categories';

/**
 * Map-pin glyphs, as raw SVG path data on a 24x24 grid (Lucide's viewBox).
 *
 * These mirror the Lucide icons wired up in `constants/categoryIcons.ts`, which
 * imports them as React components — unusable inside a map WebView, where the
 * marker has to be an SVG string. Keeping the path data here means the two
 * renderers (Google's `google.maps.Marker` icon and Leaflet's `divIcon`) share
 * one definition instead of each carrying its own copy.
 *
 * Keys are category slugs; see `CATEGORY_COLORS` for the matching palette.
 */
export const CATEGORY_MARKER_PATHS: Record<string, string[]> = {
  // Disc3
  nightlife: [
    'M12 2 A10 10 0 0 1 22 12 A10 10 0 0 1 12 22 A10 10 0 0 1 2 12 A10 10 0 0 1 12 2',
    'M6 12c0-1.7.7-3.2 1.8-4.2',
    'M12 10 A2 2 0 0 1 14 12 A2 2 0 0 1 12 14 A2 2 0 0 1 10 12 A2 2 0 0 1 12 10',
    'M18 12c0 1.7-.7 3.2-1.8 4.2',
  ],
  // MicVocal
  'live-music': [
    'm11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12',
    'M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5',
    'M16 7m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  ],
  // Coffee
  coffee: [
    'M10 2v2',
    'M14 2v2',
    'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1',
    'M6 2v2',
  ],
  // UtensilsCrossed
  dining: [
    'm16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8',
    'M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7',
    'm2.1 21.8 6.4-6.3',
    'm19 5-7 7',
  ],
  // Flame
  fitness: [
    'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  ],
  // Trophy
  sports: [
    'M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978',
    'M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978',
    'M18 9h1.5a1 1 0 0 0 0-5H18',
    'M4 22h16',
    'M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z',
    'M6 9H4.5a1 1 0 0 1 0-5H6',
  ],
  // Palette
  culture: [
    'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z',
    'M13.5 6.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
    'M17.5 10.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
    'M6.5 12.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
    'M8.5 7.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0',
  ],
  // PenTool
  workshops: [
    'M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z',
    'm18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18',
    'm2.3 2.3 7.286 7.286',
    'M11 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  // Sparkles
  markets: [
    'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    'M20 2v4',
    'M22 4h-4',
    'M4 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  // Dices
  trivia: [
    'M4 12h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
    'm17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6',
  ],
};

/**
 * Slugs that resolve to another entry's glyph and colour.
 *
 * Two groups:
 * - Event-category synonyms the palette already treats alike (`cafe`).
 * - **Business category labels.** `CATEGORY_ICON_CONFIG` is keyed by event slug
 *   *and* by business label ('Restaurant', 'Bar & Nightlife', …), and
 *   `screens/BusinessDetail.tsx` passes `getCategorySlug(business.category)`
 *   straight through as a marker `categorySlug`. Without these entries the
 *   lookup misses and every business pin falls back to the grey default, even
 *   though the business shows a proper coloured icon elsewhere in the UI.
 *   Targets chosen to match the icon each label already uses in
 *   `CATEGORY_ICON_CONFIG`.
 */
const SLUG_ALIASES: Record<string, string> = {
  cafe: 'coffee',
  'food-drink': 'coffee',
  Restaurant: 'dining',
  'Bar & Nightlife': 'nightlife',
  'Fitness & Wellness': 'fitness',
  'Coffee Shop': 'coffee',
  Entertainment: 'live-music',
};

/** MapPin — used for unknown or missing categories. */
export const DEFAULT_MARKER_PATHS: string[] = [
  'M12,2.06a5.5,5.5,0,0,0-.5,10.97v8.41a.5.5,0,0,0,.5.5.5.5,0,0,0,.5-.5V13.03A5.5,5.5,0,0,0,12,2.06Zm0,10a4.5,4.5,0,1,1,4.5-4.5A4.5,4.5,0,0,1,12,12.06Z',
];

/**
 * Full marker footprint in px. The visible disc stays at its original ~30px so
 * the map doesn't get heavier-looking; the surrounding space is transparent
 * padding that exists purely to lift the tap target to the 44pt minimum.
 */
export const MARKER_SIZE = 44;
/** Radius of the visible disc, centred in MARKER_SIZE. */
const DISC_RADIUS = 14;
/** Lucide glyphs are authored on a 24x24 grid. */
const GLYPH_GRID = 24;

export function markerPathsForSlug(slug: string | null | undefined): string[] {
  if (!slug) return DEFAULT_MARKER_PATHS;
  const resolved = SLUG_ALIASES[slug] ?? slug;
  return CATEGORY_MARKER_PATHS[resolved] ?? DEFAULT_MARKER_PATHS;
}

export function markerColorForSlug(slug: string | null | undefined): string {
  if (!slug) return DEFAULT_CATEGORY_COLOR;
  const resolved = SLUG_ALIASES[slug] ?? slug;
  return CATEGORY_COLORS[resolved] ?? CATEGORY_COLORS[slug] ?? DEFAULT_CATEGORY_COLOR;
}

/**
 * Category pin as a standalone SVG string, sized to MARKER_SIZE with the disc
 * centred. Shared by both map renderers so the two providers stay visually
 * identical.
 */
export function buildCategoryMarkerSvg(slug: string | null | undefined, isActive: boolean): string {
  const color = markerColorForSlug(slug);
  const paths = markerPathsForSlug(slug);
  const center = MARKER_SIZE / 2;
  const offset = center - GLYPH_GRID / 2;
  const discStroke = isActive ? '#1a1a1a' : 'rgba(0,0,0,0.35)';
  const discWidth = isActive ? 3 : 2;
  const glyph = paths
    .map(
      (d) =>
        `<path d="${d}" fill="${color}" stroke="#1a1a1a" stroke-width="1.2" stroke-linejoin="round"/>`
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARKER_SIZE} ${MARKER_SIZE}" width="${MARKER_SIZE}" height="${MARKER_SIZE}">` +
    `<circle cx="${center}" cy="${center}" r="${DISC_RADIUS}" fill="#ffffff" stroke="${discStroke}" stroke-width="${discWidth}"/>` +
    `<g transform="translate(${offset},${offset})">${glyph}</g>` +
    `</svg>`
  );
}

/**
 * The same builder, emitted as JavaScript source for execution *inside* a map
 * WebView. Both HTML templates inject this so the marker-drawing logic has a
 * single definition rather than one copy per provider.
 */
export function markerSvgScript(): string {
  return `
var __markerPaths = ${JSON.stringify(CATEGORY_MARKER_PATHS)};
var __markerAliases = ${JSON.stringify(SLUG_ALIASES)};
var __markerDefaultPaths = ${JSON.stringify(DEFAULT_MARKER_PATHS)};
var __markerColors = ${JSON.stringify(CATEGORY_COLORS)};
var __markerDefaultColor = ${JSON.stringify(DEFAULT_CATEGORY_COLOR)};
var __markerSize = ${MARKER_SIZE};
function __markerSvg(slug, isActive) {
  var key = (slug && __markerAliases[slug]) ? __markerAliases[slug] : slug;
  var paths = (key && __markerPaths[key]) ? __markerPaths[key] : __markerDefaultPaths;
  var color = (key && __markerColors[key]) ? __markerColors[key] : __markerDefaultColor;
  var center = __markerSize / 2;
  var offset = center - ${GLYPH_GRID / 2};
  var discStroke = isActive ? '#1a1a1a' : 'rgba(0,0,0,0.35)';
  var discWidth = isActive ? 3 : 2;
  var glyph = paths.map(function (d) {
    return '<path d="' + d + '" fill="' + color + '" stroke="#1a1a1a" stroke-width="1.2" stroke-linejoin="round"/>';
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + __markerSize + ' ' + __markerSize + '" width="' + __markerSize + '" height="' + __markerSize + '">'
    + '<circle cx="' + center + '" cy="' + center + '" r="${DISC_RADIUS}" fill="#ffffff" stroke="' + discStroke + '" stroke-width="' + discWidth + '"/>'
    + '<g transform="translate(' + offset + ',' + offset + ')">' + glyph + '</g>'
    + '</svg>';
}`;
}
