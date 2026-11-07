/**
 * Stand-in for utils/openMapHtml.ts in Google-provider builds (metro.config.js
 * redirects that import here), so the ~200 KB of inlined Leaflet isn't
 * bundled. GoogleMapView only calls buildOpenMapHtml when the provider is NOT
 * Google, so this is never reached.
 */
export function buildOpenMapHtml(..._args: unknown[]): string {
  throw new Error('Open map is not bundled in Google-provider builds (EXPO_PUBLIC_MAP_PROVIDER=google).');
}
