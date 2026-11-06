/**
 * Cross-provider invariants.
 *
 * Leaflet is the default provider and Google is opt-in, so the two pages are
 * maintained separately and can silently drift — which is exactly what
 * happened before the marker definitions were shared. These assertions pin the
 * contract both GoogleMapView and discover.tsx rely on.
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildOpenMapHtml } from '@/utils/openMapHtml';
import { buildMapHtml } from '@/utils/googleMapHtml';
import { buildCategoryMarkerSvg, CATEGORY_MARKER_PATHS } from '@/constants/categoryMarkers';
import { buildAnimateToInjection } from '@/utils/webviewInject';

const leafletHtml = buildOpenMapHtml({ lat: 37.7749, lng: -122.4194 }, 12, true);
const googleHtml = buildMapHtml('K', { lat: 37.7749, lng: -122.4194 }, 12, true, true, true, true);

/** Leaflet runs standalone (the bundle is inlined). */
function bootLeaflet() {
  const proto = 'HTMLElement';
  const dom = new JSDOM(leafletHtml, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      const el = (window as unknown as Record<string, any>)[proto].prototype;
      for (const prop of ['clientWidth', 'offsetWidth']) {
        Object.defineProperty(el, prop, { configurable: true, value: 1024 });
      }
      for (const prop of ['clientHeight', 'offsetHeight']) {
        Object.defineProperty(el, prop, { configurable: true, value: 768 });
      }
    },
  });
  return dom.window;
}

/** Google needs its SDK stubbed and initMap invoked, as the real callback does. */
function bootGoogle() {
  const dom = new JSDOM(googleHtml, { runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window as unknown as Record<string, any>;
  win.google = {
    maps: {
      Map: function (this: any) {
        this.addListener = () => {};
        this.getCenter = () => ({ lat: () => 0, lng: () => 0 });
        this.getBounds = () => null;
        this.panTo = () => {};
        this.setZoom = () => {};
      },
      Marker: function (this: any) {
        this.setMap = () => {};
        this.setIcon = () => {};
        this.addListener = () => {};
      },
      Size: function () {},
      Point: function () {},
    },
  };
  win.initMap();
  return dom.window;
}

describe('both pages expose the same injected API', () => {
  // GoogleMapView injects these names regardless of which provider is active.
  const required = ['window.__updateMarkers', 'window.__updateActiveMarker', 'window.__map'];

  it('Leaflet defines them', () => {
    for (const name of required) expect(leafletHtml, name).toContain(name);
  });

  it('Google defines them', () => {
    for (const name of required) expect(googleHtml, name).toContain(name);
  });

  it('buildAnimateToInjection drives __map on both providers', () => {
    // The contract is the runtime shape, not the source text: Leaflet wraps an
    // adapter in the page, while Google assigns the native google.maps.Map
    // (whose own panTo/setZoom satisfy the same call signature).
    const script = buildAnimateToInjection(40.7128, -74.006, 15)!;
    expect(script).not.toBeNull();

    for (const [label, win] of [
      ['leaflet', bootLeaflet()],
      ['google', bootGoogle()],
    ] as const) {
      const map = (win as unknown as Record<string, any>).__map;
      expect(typeof map.panTo, `${label} panTo`).toBe('function');
      expect(typeof map.setZoom, `${label} setZoom`).toBe('function');
      // Executing the real injection must not throw against either page.
      expect(() => {
        new Function('window', script)(win);
      }, label).not.toThrow();
    }
  });
});

describe('both pages emit the same message types', () => {
  const types = ['mapReady', 'markerPress', 'mapPress', 'regionChange'];

  it('Leaflet emits all four', () => {
    for (const t of types) expect(leafletHtml, t).toContain(`'${t}'`);
  });

  it('Google emits all four', () => {
    for (const t of types) expect(googleHtml, t).toContain(`'${t}'`);
  });
});

describe('both pages report when map imagery is unavailable', () => {
  it("Leaflet reports failing tiles and recovery", () => {
    expect(leafletHtml).toContain("'mapUnavailable'");
    expect(leafletHtml).toContain("'mapAvailable'");
    expect(leafletHtml).toContain("'tileerror'");
  });

  it('Google reports an SDK that fails to load or is refused', () => {
    expect(googleHtml).toContain("'mapUnavailable'");
    expect(googleHtml).toContain('gm_authFailure');
    expect(googleHtml).toContain("onerror=\"window.__mapUnavailable('script')\"");
  });
});

describe('marker artwork is identical across providers', () => {
  /** Pull the in-page builder out of a generated document. */
  function markerSvgFrom(html: string): (slug: string, active: boolean) => string {
    const dom = new JSDOM(html, { runScripts: 'dangerously' });
    const fn = (dom.window as unknown as Record<string, unknown>).__markerSvg;
    expect(typeof fn).toBe('function');
    return fn as (slug: string, active: boolean) => string;
  }

  it('Leaflet and Google draw the same pin for every category and state', () => {
    const leaflet = markerSvgFrom(leafletHtml);
    const google = markerSvgFrom(googleHtml);
    const slugs = [...Object.keys(CATEGORY_MARKER_PATHS), 'cafe', 'food-drink', 'Restaurant', 'unknown'];
    for (const slug of slugs) {
      for (const active of [false, true]) {
        const fromLeaflet = leaflet(slug, active);
        const fromGoogle = google(slug, active);
        expect(fromGoogle, `${slug} active=${active}`).toBe(fromLeaflet);
        // ...and both match the TypeScript builder used outside the WebView.
        expect(fromLeaflet, `${slug} active=${active} vs TS`).toBe(
          buildCategoryMarkerSvg(slug, active)
        );
      }
    }
  });
});

describe('both pages are self-contained', () => {
  it('Leaflet loads nothing from a CDN', () => {
    // Vendored so the default provider works offline and gains no third-party
    // runtime dependency. Tile requests are the only external calls.
    const scriptSrcs = [...leafletHtml.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    expect(scriptSrcs).toEqual([]);
  });

  it('Google loads only Google and the clusterer', () => {
    const scriptSrcs = [...googleHtml.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    for (const src of scriptSrcs) {
      expect(src, src).toMatch(/^https:\/\/(maps\.googleapis\.com|unpkg\.com)\//);
    }
  });
});
