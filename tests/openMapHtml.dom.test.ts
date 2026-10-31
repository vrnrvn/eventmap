/**
 * Executes the generated Leaflet page in jsdom and drives it through the same
 * API GoogleMapView injects. Catches the class of failure that fragment and
 * syntax checks cannot: the plugin not registering, clustering not engaging,
 * markers not reaching the map.
 *
 * Tiles never load under jsdom — irrelevant here, the assertions are about
 * marker and cluster DOM.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JSDOM, type DOMWindow } from 'jsdom';
import { buildOpenMapHtml } from '@/utils/openMapHtml';
import { CATEGORY_COLORS } from '@/constants/categories';

type MapWindow = Window & {
  __updateMarkers: (data: unknown[], active: string) => void;
  __updateActiveMarker: (id: string) => void;
  __map: { panTo: (c: { lat: number; lng: number }) => void; setZoom: (z: number) => void };
  L?: { markerClusterGroup?: unknown };
};

let dom: JSDOM;
let win: MapWindow;

/** Leaflet needs a non-zero container; jsdom reports 0 for everything. */
function stubLayout(window: DOMWindow) {
  const proto = window.HTMLElement.prototype;
  Object.defineProperty(proto, 'clientWidth', { configurable: true, value: 1024 });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, value: 768 });
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, value: 1024 });
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, value: 768 });
  proto.getBoundingClientRect = () =>
    ({ width: 1024, height: 768, top: 0, left: 0, right: 1024, bottom: 768, x: 0, y: 0 }) as DOMRect;
}

beforeAll(async () => {
  dom = new JSDOM(buildOpenMapHtml({ lat: 37.7749, lng: -122.4194 }, 12, true), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse: stubLayout,
  });
  win = dom.window as unknown as MapWindow;
  // Let Leaflet finish its initial layout pass.
  await new Promise((r) => setTimeout(r, 50));
});

afterAll(() => dom?.window?.close());

const markers = (n: number, slug = 'dining') =>
  Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    // Tight cluster around SF so they group at zoom 12.
    lat: 37.7749 + i * 0.0005,
    lng: -122.4194 + i * 0.0005,
    title: `Event ${i}`,
    categorySlug: slug,
  }));

const q = (sel: string) => dom.window.document.querySelectorAll(sel);

describe('Leaflet page boots', () => {
  it('registers Leaflet and the clustering plugin', () => {
    expect(typeof win.L).toBe('object');
    expect(typeof win.L?.markerClusterGroup).toBe('function');
  });

  it('exposes the API GoogleMapView injects against', () => {
    expect(typeof win.__updateMarkers).toBe('function');
    expect(typeof win.__updateActiveMarker).toBe('function');
    expect(typeof win.__map.panTo).toBe('function');
    expect(typeof win.__map.setZoom).toBe('function');
  });

  it('creates the map container', () => {
    expect(q('.leaflet-container').length).toBe(1);
  });
});

describe('markers', () => {
  it('renders a single marker as a category pin, not a cluster', () => {
    win.__updateMarkers(markers(1), '');
    expect(q('.event-pin').length).toBe(1);
    expect(q('.evm-cluster').length).toBe(0);
  });

  it('colours the pin by category', () => {
    win.__updateMarkers(markers(1, 'nightlife'), '');
    const svg = q('.event-pin')[0].innerHTML;
    expect(svg).toContain(CATEGORY_COLORS.nightlife);

    win.__updateMarkers(markers(1, 'sports'), '');
    expect(q('.event-pin')[0].innerHTML).toContain(CATEGORY_COLORS.sports);
  });

  it('gives the pin a 44pt footprint', () => {
    win.__updateMarkers(markers(1), '');
    const el = q('.event-pin')[0] as HTMLElement;
    expect(el.style.width).toBe('44px');
    expect(el.style.height).toBe('44px');
  });

  it('replaces markers rather than accumulating them', () => {
    win.__updateMarkers(markers(1), '');
    win.__updateMarkers(markers(1), '');
    win.__updateMarkers(markers(1), '');
    expect(q('.event-pin').length).toBe(1);
  });

  it('clears to empty', () => {
    win.__updateMarkers(markers(3), '');
    win.__updateMarkers([], '');
    expect(q('.event-pin').length).toBe(0);
    expect(q('.evm-cluster').length).toBe(0);
  });

  it('never turns a title into live markup', () => {
    // The payload legitimately appears inside Leaflet's title/alt *attributes*
    // (inert), so assert on the parsed DOM rather than on serialised HTML:
    // nothing may be instantiated as an element or an event-handler attribute.
    const imgsBefore = q('img:not(.leaflet-tile)').length;
    win.__updateMarkers(
      [{ id: 'x', lat: 37.7749, lng: -122.4194, title: '<img src=x onerror=alert(1)>' }],
      ''
    );
    expect(q('img:not(.leaflet-tile)').length).toBe(imgsBefore);
    const withHandler = [...q('*')].filter((el) =>
      [...el.attributes].some((a) => a.name.toLowerCase().startsWith('on'))
    );
    expect(withHandler).toEqual([]);
    // And the tooltip shows it as literal text.
    const pin = q('.event-pin')[0];
    expect(pin.getAttribute('title')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('clustering', () => {
  it('collapses co-located markers into a cluster bubble', () => {
    win.__updateMarkers(markers(40), '');
    const clusters = q('.evm-cluster');
    expect(clusters.length).toBeGreaterThan(0);
    // The whole point: far fewer DOM pins than markers.
    expect(q('.event-pin').length).toBeLessThan(40);
  });

  it('labels the bubble with the child count', () => {
    win.__updateMarkers(markers(12), '');
    const text = [...q('.evm-cluster')].map((n) => n.textContent?.trim()).join(',');
    expect(text).toMatch(/\d+/);
    const total = [...q('.evm-cluster')].reduce(
      (sum, n) => sum + Number(n.textContent?.trim() || 0),
      0
    );
    expect(total + q('.event-pin').length).toBe(12);
  });

  it('caps the label at 99+', () => {
    // Exactly co-located so they form a single cluster rather than several
    // sub-100 ones.
    const stacked = Array.from({ length: 150 }, (_, i) => ({
      id: `e${i}`,
      lat: 37.7749,
      lng: -122.4194,
      title: `Event ${i}`,
      categorySlug: 'dining',
    }));
    win.__updateMarkers(stacked, '');
    const labels = [...q('.evm-cluster')].map((n) => n.textContent?.trim());
    expect(labels).toContain('99+');
  });

  it('handles a large set without error', () => {
    expect(() => win.__updateMarkers(markers(1000), '')).not.toThrow();
    // Clustered, so the DOM stays far smaller than the dataset.
    expect(q('.event-pin').length + q('.evm-cluster').length).toBeLessThan(1000);
  });
});

describe('regionChange messages', () => {
  type Msg = { type: string; lat?: number; lng?: number; bounds?: unknown };

  /** Capture what the page posts back to React Native. */
  function collect(): Msg[] {
    const seen: Msg[] = [];
    (win as unknown as { ReactNativeWebView: { postMessage: (s: string) => void } }).ReactNativeWebView =
      { postMessage: (s: string) => seen.push(JSON.parse(s)) };
    return seen;
  }

  it('emits exactly one regionChange per zoom', () => {
    // Leaflet fires zoomend *and* moveend for a single zoom; listening to both
    // double-posted every zoom across the bridge.
    const seen = collect();
    win.__map.setZoom(13);
    const regions = seen.filter((m) => m.type === 'regionChange');
    expect(regions.length).toBe(1);
  });

  it('includes centre and bounds', () => {
    const seen = collect();
    win.__map.setZoom(12);
    const region = seen.find((m) => m.type === 'regionChange');
    expect(region).toBeDefined();
    expect(typeof region?.lat).toBe('number');
    expect(typeof region?.lng).toBe('number');
    expect(region?.bounds).toBeTruthy();
  });

  it('does not double-post while panning', async () => {
    // panTo animates via CSS transitions, which jsdom does not drive, so
    // moveend may never fire here. The assertion that carries weight is the
    // absence of duplicates — the per-zoom count above covers the fire path.
    const seen = collect();
    win.__map.panTo({ lat: 37.8, lng: -122.3 });
    await new Promise((r) => setTimeout(r, 120));
    expect(seen.filter((m) => m.type === 'regionChange').length).toBeLessThanOrEqual(1);
  });
});

describe('clusters are reachable', () => {
  it('labels cluster bubbles for assistive tech', () => {
    win.__updateMarkers(
      Array.from({ length: 20 }, (_, i) => ({
        id: `c${i}`,
        lat: 37.7749,
        lng: -122.4194,
        title: `Event ${i}`,
        categorySlug: 'dining',
      })),
      ''
    );
    const bubble = q('.evm-cluster div')[0];
    expect(bubble?.getAttribute('aria-label')).toMatch(/\d+ events in this area/);
    expect(bubble?.getAttribute('role')).toBe('button');
  });
});

describe('active marker', () => {
  it('marks the selected pin active without changing the marker count', () => {
    // Far enough apart to stay unclustered (>maxClusterRadius at zoom 12) but
    // still inside the viewport — markercluster drops off-screen markers from
    // the DOM entirely, so a wider spread would render only one pin.
    const spread = Array.from({ length: 3 }, (_, i) => ({
      id: `e${i}`,
      lat: 37.7749 + i * 0.03,
      lng: -122.4194 + i * 0.03,
      title: `Event ${i}`,
      categorySlug: 'dining',
    }));
    win.__updateMarkers(spread, '');
    expect(q('.event-pin.active').length).toBe(0);

    win.__updateActiveMarker('e1');
    expect(q('.event-pin.active').length).toBe(1);
    expect(q('.event-pin').length).toBe(3);
  });

  it('moves the active state between pins', () => {
    win.__updateActiveMarker('e2');
    expect(q('.event-pin.active').length).toBe(1);
    win.__updateActiveMarker('');
    expect(q('.event-pin.active').length).toBe(0);
  });

  it('tolerates an unknown id', () => {
    expect(() => win.__updateActiveMarker('does-not-exist')).not.toThrow();
  });
});
