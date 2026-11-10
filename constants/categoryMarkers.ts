import { categoryIconPathTable, DEFAULT_CATEGORY_ICON, getCategoryIconEntry } from './categoryIconRegistry';
import { CATEGORY_SEED, CATEGORY_SLUG_ALIASES } from './categorySeed';
import { BUSINESS_CATEGORIES } from './businessCategories';
import { DEFAULT_CATEGORY_COLOR, presentCategory } from '@/utils/categoryPresentation';

/**
 * Map-pin rendering shared by both map providers (Google's `google.maps.Marker`
 * icon and Leaflet's `divIcon`).
 *
 * A marker's style comes from the event row it represents: `categoryColor`
 * and `categoryIconKey` are passed per marker (Discover copies them from the
 * category row), so pins follow the database without an app rebuild. Markers
 * that only carry a `categorySlug` (older callers, business pins) resolve
 * through the bundled seed, and anything unknown falls back to a grey pin.
 *
 * Glyph path data lives in constants/categoryIconRegistry.ts next to the
 * React components, so the chip and the pin for a category cannot drift.
 */
export type MarkerStyleInput =
  | string
  | {
      categorySlug?: string | null;
      categoryColor?: string | null;
      categoryIconKey?: string | null;
    }
  | null
  | undefined;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Path tables keyed by Lucide icon name. */
export const CATEGORY_ICON_PATHS: Readonly<Record<string, readonly string[]>> = categoryIconPathTable();

/**
 * slug → { color, iconKey } for every seeded category, its aliases, and the
 * business category labels (BusinessDetail passes `business.category` as a
 * marker slug). An empty iconKey means "colour only, pin glyph".
 */
export const CATEGORY_SLUG_STYLES: Readonly<Record<string, { color: string; iconKey: string }>> = (() => {
  const table: Record<string, { color: string; iconKey: string }> = {};
  for (const c of CATEGORY_SEED) table[c.slug] = { color: c.color, iconKey: c.icon_key };
  for (const [alias, target] of Object.entries(CATEGORY_SLUG_ALIASES)) {
    if (table[target]) table[alias] = table[target];
  }
  for (const b of BUSINESS_CATEGORIES) {
    if (!table[b.label]) table[b.label] = { color: b.color, iconKey: b.iconKey ?? '' };
  }
  return table;
})();

/** MapPin — used for unknown or missing categories. */
export const DEFAULT_MARKER_PATHS: readonly string[] = DEFAULT_CATEGORY_ICON.paths;

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

export function resolveMarkerStyle(input: MarkerStyleInput): { color: string; paths: readonly string[] } {
  if (input == null || typeof input === 'string') {
    const p = presentCategory(input);
    return { color: p.color, paths: p.paths };
  }
  const fromSlug = input.categorySlug ? presentCategory(input.categorySlug) : null;
  const color =
    input.categoryColor && HEX.test(input.categoryColor)
      ? input.categoryColor
      : fromSlug?.color ?? DEFAULT_CATEGORY_COLOR;
  const explicitIcon = input.categoryIconKey ? getCategoryIconEntry(input.categoryIconKey) : null;
  const paths =
    explicitIcon && explicitIcon !== DEFAULT_CATEGORY_ICON
      ? explicitIcon.paths
      : fromSlug?.paths ?? DEFAULT_MARKER_PATHS;
  return { color, paths };
}

export function markerPathsForSlug(slug: string | null | undefined): readonly string[] {
  return resolveMarkerStyle(slug).paths;
}

export function markerColorForSlug(slug: string | null | undefined): string {
  return resolveMarkerStyle(slug).color;
}

/**
 * Category pin as a standalone SVG string, sized to MARKER_SIZE with the disc
 * centred. Shared by both map renderers so the two providers stay visually
 * identical.
 */
export function buildCategoryMarkerSvg(input: MarkerStyleInput, isActive: boolean): string {
  const { color, paths } = resolveMarkerStyle(input);
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
 * Cluster colour: the most common category colour among the cluster's
 * markers (ties → the colour seen first), or the neutral default when there
 * are none. Mirrored by `__markerDominantColor` in markerSvgScript.
 */
export function dominantMarkerColor(inputs: readonly MarkerStyleInput[]): string {
  const counts = new Map<string, number>();
  let best = DEFAULT_CATEGORY_COLOR;
  let bestN = 0;
  for (const input of inputs) {
    const c = resolveMarkerStyle(input).color;
    const n = (counts.get(c) ?? 0) + 1;
    counts.set(c, n);
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

/**
 * The same builder, emitted as JavaScript source for execution *inside* a map
 * WebView. Both HTML templates inject this so the marker-drawing logic has a
 * single definition rather than one copy per provider. `__markerSvg` accepts
 * either a slug string or a marker object ({categorySlug, categoryColor,
 * categoryIconKey}), mirroring resolveMarkerStyle.
 */
export function markerSvgScript(): string {
  return `
var __markerIconPaths = ${JSON.stringify(CATEGORY_ICON_PATHS)};
var __markerSlugStyles = ${JSON.stringify(CATEGORY_SLUG_STYLES)};
var __markerDefaultPaths = ${JSON.stringify(DEFAULT_MARKER_PATHS)};
var __markerDefaultColor = ${JSON.stringify(DEFAULT_CATEGORY_COLOR)};
var __markerSize = ${MARKER_SIZE};
var __markerHex = /^#[0-9a-fA-F]{6}$/;
function __markerStyle(input) {
  var slug = (input && typeof input === 'object') ? (input.categorySlug || '') : (input || '');
  var bySlug = slug && __markerSlugStyles[slug] ? __markerSlugStyles[slug] : null;
  var color = bySlug ? bySlug.color : __markerDefaultColor;
  var iconKey = bySlug ? bySlug.iconKey : '';
  if (input && typeof input === 'object') {
    if (input.categoryColor && __markerHex.test(input.categoryColor)) color = input.categoryColor;
    if (input.categoryIconKey && __markerIconPaths[input.categoryIconKey]) iconKey = input.categoryIconKey;
  }
  var paths = (iconKey && __markerIconPaths[iconKey]) ? __markerIconPaths[iconKey] : __markerDefaultPaths;
  return { color: color, paths: paths };
}
function __markerDominantColor(inputs) {
  var counts = {}, best = __markerDefaultColor, bestN = 0;
  for (var i = 0; i < inputs.length; i++) {
    var c = __markerStyle(inputs[i]).color;
    counts[c] = (counts[c] || 0) + 1;
    if (counts[c] > bestN) { best = c; bestN = counts[c]; }
  }
  return best;
}
function __markerSvg(input, isActive) {
  var style = __markerStyle(input);
  var center = __markerSize / 2;
  var offset = center - ${GLYPH_GRID / 2};
  var discStroke = isActive ? '#1a1a1a' : 'rgba(0,0,0,0.35)';
  var discWidth = isActive ? 3 : 2;
  var glyph = style.paths.map(function (d) {
    return '<path d="' + d + '" fill="' + style.color + '" stroke="#1a1a1a" stroke-width="1.2" stroke-linejoin="round"/>';
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + __markerSize + ' ' + __markerSize + '" width="' + __markerSize + '" height="' + __markerSize + '">'
    + '<circle cx="' + center + '" cy="' + center + '" r="${DISC_RADIUS}" fill="#ffffff" stroke="' + discStroke + '" stroke-width="' + discWidth + '"/>'
    + '<g transform="translate(' + offset + ',' + offset + ')">' + glyph + '</g>'
    + '</svg>';
}`;
}
