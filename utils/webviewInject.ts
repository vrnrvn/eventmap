/**
 * Builders for the JavaScript snippets injected into a map WebView.
 *
 * Marker data crosses the bridge as source code: it is JSON-encoded, embedded
 * in a single-quoted string literal, and `JSON.parse`d on the other side. Event
 * titles are user-supplied, so the encoding has to survive quotes, backslashes,
 * newlines and anything else a title can contain — a malformed literal is a
 * *syntax* error, which means the whole snippet fails to parse and markers
 * silently stop updating (the inner try/catch never even runs).
 */

export type InjectableMarker = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  categorySlug?: string;
  [key: string]: unknown;
};

/**
 * JSON-encode a value and escape it for embedding inside a single-quoted
 * JavaScript string literal.
 *
 * U+2028/U+2029 are deliberately escaped last: `JSON.stringify` leaves them
 * raw (they are legal in JSON strings) but they are line terminators in older
 * JS engines, where an unescaped one truncates the literal and breaks the whole
 * injection. They stay valid JSON once the literal is unescaped.
 */
export function encodeForSingleQuotedLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Full marker-set replacement. */
export function buildMarkersInjection(
  markers: readonly InjectableMarker[],
  activeId: string
): string {
  const markersArg = encodeForSingleQuotedLiteral(markers);
  const activeArg = encodeForSingleQuotedLiteral(activeId);
  return `(function(){if(typeof window.__updateMarkers==='function'){try{window.__updateMarkers(JSON.parse('${markersArg}'),JSON.parse('${activeArg}'));}catch(e){}}}());true;`;
}

/** Cheap highlight-only update when the marker set itself is unchanged. */
export function buildActiveMarkerInjection(activeId: string): string {
  const activeArg = encodeForSingleQuotedLiteral(activeId);
  return `(function(){if(typeof window.__updateActiveMarker==='function'){try{window.__updateActiveMarker(JSON.parse('${activeArg}'));}catch(e){}}}());true;`;
}

/**
 * Coerce to a finite number, rejecting the values `Number()` quietly turns into
 * one. `Number(null)`, `Number('')` and `Number(false)` are all `0`, so a null
 * latitude from the database would otherwise pan the map to the Gulf of Guinea
 * instead of being ignored.
 */
function finiteCoord(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pan (and optionally zoom) the already-loaded map. Ignores unusable input. */
export function buildAnimateToInjection(lat: number, lng: number, zoom?: number): string | null {
  const safeLat = finiteCoord(lat);
  const safeLng = finiteCoord(lng);
  if (safeLat === null || safeLng === null) return null;
  const safeZoom = typeof zoom === 'number' ? Number(zoom) : NaN;
  const zoomPart = Number.isFinite(safeZoom) ? `m.setZoom(${JSON.stringify(safeZoom)});` : '';
  return `(function(){var m=window.__map;if(m){m.panTo({lat:${JSON.stringify(safeLat)},lng:${JSON.stringify(safeLng)}});${zoomPart}}})();true;`;
}
