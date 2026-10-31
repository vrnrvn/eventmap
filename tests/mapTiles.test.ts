import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildOpenMapHtml } from '@/utils/openMapHtml';

const DEFAULT_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Re-import the module with a given env so the module-level reads re-run. */
async function loadWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await import('@/constants/mapTiles');
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('tile configuration', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('defaults to OSM so local dev needs no key', async () => {
    const m = await loadWith({
      EXPO_PUBLIC_MAP_TILE_URL: undefined,
      EXPO_PUBLIC_MAP_TILE_ATTRIBUTION: undefined,
    });
    expect(m.mapTileUrl).toBe(DEFAULT_URL);
    expect(m.mapTileAttribution).toContain('OpenStreetMap');
    expect(m.usingDefaultOsmTiles).toBe(true);
  });

  it('honours an override', async () => {
    const m = await loadWith({
      EXPO_PUBLIC_MAP_TILE_URL: 'https://tiles.example.com/{z}/{x}/{y}.png?k=abc',
      EXPO_PUBLIC_MAP_TILE_ATTRIBUTION: '&copy; Example',
    });
    expect(m.mapTileUrl).toBe('https://tiles.example.com/{z}/{x}/{y}.png?k=abc');
    expect(m.mapTileAttribution).toBe('&copy; Example');
    expect(m.usingDefaultOsmTiles).toBe(false);
  });

  it('rejects non-http(s) tile URLs', async () => {
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x']) {
      const m = await loadWith({ EXPO_PUBLIC_MAP_TILE_URL: bad });
      expect(m.mapTileUrl, bad).toBe(DEFAULT_URL);
    }
  });

  it('ignores a blank override', async () => {
    const m = await loadWith({ EXPO_PUBLIC_MAP_TILE_URL: '   ' });
    expect(m.mapTileUrl).toBe(DEFAULT_URL);
  });

  it('clamps max zoom to a sane range', async () => {
    expect((await loadWith({ EXPO_PUBLIC_MAP_TILE_MAX_ZOOM: '22' })).mapTileMaxZoom).toBe(22);
    expect((await loadWith({ EXPO_PUBLIC_MAP_TILE_MAX_ZOOM: '99' })).mapTileMaxZoom).toBe(19);
    expect((await loadWith({ EXPO_PUBLIC_MAP_TILE_MAX_ZOOM: 'abc' })).mapTileMaxZoom).toBe(19);
    expect((await loadWith({ EXPO_PUBLIC_MAP_TILE_MAX_ZOOM: '0' })).mapTileMaxZoom).toBe(19);
  });
});

describe('tile config reaches the generated page safely', () => {
  it('includes the tile URL and attribution', () => {
    const html = buildOpenMapHtml({ lat: 1, lng: 2 }, 12, true);
    expect(html).toContain(JSON.stringify(DEFAULT_URL));
    expect(html).toContain('OpenStreetMap');
  });

  it('serialises config rather than interpolating it raw', () => {
    // Attribution is intentionally HTML (it carries a link), so it must at
    // least be a well-formed JS string literal in the page source.
    const html = buildOpenMapHtml({ lat: 1, lng: 2 }, 12, true);
    // Non-greedy: the attribution contains '&copy;', so a [^;]* bound stops short.
    const call = html.match(/L\.tileLayer\([\s\S]*?\)\.addTo\(map\);/)?.[0] ?? '';
    expect(call).toContain('L.tileLayer("https://');
    expect(() => new Function(`var L={tileLayer:function(){return{addTo:function(){}}}};var map={};${call}`)).not.toThrow();
  });
});
