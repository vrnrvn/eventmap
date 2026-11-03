export type LatLng = { lat: number; lng: number };
export type MapBounds = { ne: LatLng; sw: LatLng };

// Search radius follows the map viewport (see radiusKmFromBounds); the old
// fixed 50 km stays as the fallback until the map reports its first bounds.
export const DEFAULT_RADIUS_KM = 50;
export const MIN_RADIUS_KM = 5;
export const MAX_RADIUS_KM = 150;

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Zoom-derived search radius: half the viewport diagonal (so the search circle
 * roughly circumscribes what's on screen), clamped to [5, 150] km. Both map
 * HTMLs include `bounds` in their regionChange messages; an older cached map
 * HTML without bounds leaves this null and the legacy 50 km default applies.
 */
export function radiusKmFromBounds(bounds: MapBounds | null): number {
  if (!bounds) return DEFAULT_RADIUS_KM;
  const diagonalKm = haversineKm(bounds.ne, bounds.sw);
  if (!Number.isFinite(diagonalKm) || diagonalKm <= 0) return DEFAULT_RADIUS_KM;
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, diagonalKm / 2));
}

/**
 * Whether a point falls inside the reported viewport.
 *
 * Handles the antimeridian: a viewport straddling ±180° reports `sw.lng` greater
 * than `ne.lng` (e.g. sw=170, ne=-170), where a plain range check excludes
 * everything and empties the list for anyone near the date line.
 */
export function isInBounds(lat: number, lng: number, bounds: MapBounds): boolean {
  if (lat < bounds.sw.lat || lat > bounds.ne.lat) return false;
  if (bounds.sw.lng > bounds.ne.lng) {
    return lng >= bounds.sw.lng || lng <= bounds.ne.lng;
  }
  return lng >= bounds.sw.lng && lng <= bounds.ne.lng;
}

/** Bounding box of a set of points, or null when the set is empty. */
export function boundsOfPoints(points: LatLng[]): MapBounds | null {
  if (points.length === 0) return null;
  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { ne: { lat: maxLat, lng: maxLng }, sw: { lat: minLat, lng: minLng } };
}

/** Midpoint of a set of points, or null when the set is empty. */
export function centroidOf(points: LatLng[]): LatLng | null {
  const bounds = boundsOfPoints(points);
  if (!bounds) return null;
  return {
    lat: (bounds.ne.lat + bounds.sw.lat) / 2,
    lng: (bounds.ne.lng + bounds.sw.lng) / 2,
  };
}

/**
 * Zoom level at which a lat/lng span comfortably fits the viewport. The whole
 * world (360° of longitude) fits at zoom 0 and each level halves the span, so
 * log2 gives the fit; one level is subtracted for padding. Clamped to a sane
 * range so a single point doesn't request maximum zoom.
 */
export function zoomForPoints(points: LatLng[], fallbackZoom = 12): number {
  const bounds = boundsOfPoints(points);
  if (!bounds) return fallbackZoom;
  const latSpan = bounds.ne.lat - bounds.sw.lat;
  const lngSpan = bounds.ne.lng - bounds.sw.lng;
  const span = Math.max(latSpan, lngSpan);
  if (!Number.isFinite(span) || span <= 0) return fallbackZoom;
  const zoom = Math.log2(360 / span) - 1;
  return Math.min(15, Math.max(2, Math.round(zoom)));
}
