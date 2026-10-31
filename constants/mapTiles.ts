/**
 * Raster tile source for the Leaflet (default) map provider.
 *
 * ## Why this is configurable
 *
 * The built-in default points at `tile.openstreetmap.org`. That is fine for
 * local development, but the OSM Foundation's Tile Usage Policy treats
 * *distributing an app* that pulls from it as "heavy use", which is not
 * permitted without prior approval — the stated remedy is to run your own tile
 * server or use a third-party one. Violating apps get blocked outright.
 *
 * So: **before shipping to real users, set `EXPO_PUBLIC_MAP_TILE_URL` and
 * `EXPO_PUBLIC_MAP_TILE_ATTRIBUTION` to a provider you are entitled to use.**
 * Any XYZ raster endpoint works (Stadia Maps, Thunderforest, Geoapify, MapTiler,
 * or self-hosted). Keeping the OSM default here preserves the key-free local
 * setup the README promises; overriding is a config change, not a code change.
 *
 * @see https://operations.osmfoundation.org/policies/tiles/
 */

const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Tile templates are injected into the page; only http(s) endpoints are allowed. */
function safeTileUrl(value: string | undefined): string {
  const url = value?.trim();
  if (!url) return DEFAULT_TILE_URL;
  if (!/^https?:\/\//i.test(url)) {
    console.warn('[mapTiles] EXPO_PUBLIC_MAP_TILE_URL must be an http(s) URL; using the default.');
    return DEFAULT_TILE_URL;
  }
  return url;
}

export const mapTileUrl = safeTileUrl(process.env.EXPO_PUBLIC_MAP_TILE_URL);

export const mapTileAttribution =
  process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION?.trim() || DEFAULT_ATTRIBUTION;

/** Most XYZ raster sets stop at 19; override if the provider serves deeper. */
export const mapTileMaxZoom = (() => {
  const raw = Number(process.env.EXPO_PUBLIC_MAP_TILE_MAX_ZOOM);
  return Number.isFinite(raw) && raw >= 1 && raw <= 24 ? Math.floor(raw) : 19;
})();

/** True when still on the shared OSM tiles, i.e. not cleared for distribution. */
export const usingDefaultOsmTiles = mapTileUrl === DEFAULT_TILE_URL;
