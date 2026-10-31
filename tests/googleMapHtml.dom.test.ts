/**
 * Executes the Google Maps page in jsdom against a stubbed `google.maps` SDK.
 *
 * The real SDK never loads here (jsdom doesn't fetch external scripts), so the
 * test calls the `initMap` callback itself — which is exactly what the SDK does
 * via `&callback=initMap`. That exercises marker creation, clustering, the
 * clusterer-missing fallback, icon generation and the postMessage contract.
 */
import { describe, it, expect } from 'vitest';
import { JSDOM, type DOMWindow } from 'jsdom';
import { buildMapHtml } from '@/utils/googleMapHtml';
import { CATEGORY_COLORS } from '@/constants/categories';
import { MARKER_SIZE } from '@/constants/categoryMarkers';

type Listener = (...args: unknown[]) => void;

type StubMarker = {
  opts: Record<string, unknown>;
  map: unknown;
  icon: Record<string, unknown>;
  listeners: Record<string, Listener[]>;
  setMap: (m: unknown) => void;
  setIcon: (i: Record<string, unknown>) => void;
  addListener: (ev: string, fn: Listener) => void;
};

type Harness = {
  win: DOMWindow & Record<string, any>;
  dom: JSDOM;
  markers: StubMarker[];
  messages: { type: string; [k: string]: unknown }[];
  mapListeners: Record<string, Listener[]>;
  clusterer: { added: unknown[][]; cleared: number } | null;
};

/** Build the page, stub the SDK, run initMap. */
function boot(
  opts: {
    withClusterer?: boolean;
    clustererThrowsOnAdd?: boolean;
    selectable?: boolean;
    hasMarkerPress?: boolean;
    hasRegionChange?: boolean;
    gestures?: boolean;
  } = {}
): Harness {
  const {
    withClusterer = true,
    clustererThrowsOnAdd = false,
    selectable = true,
    hasMarkerPress = true,
    hasRegionChange = true,
    gestures = true,
  } = opts;

  const html = buildMapHtml(
    'TEST_KEY',
    { lat: 37.7749, lng: -122.4194 },
    12,
    selectable,
    hasMarkerPress,
    hasRegionChange,
    gestures
  );

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window as DOMWindow & Record<string, any>;

  const markers: StubMarker[] = [];
  const messages: Harness['messages'] = [];
  const mapListeners: Record<string, Listener[]> = {};
  let clusterer: Harness['clusterer'] = null;

  win.ReactNativeWebView = { postMessage: (s: string) => messages.push(JSON.parse(s)) };

  win.google = {
    maps: {
      Map: function (this: any) {
        this.addListener = (ev: string, fn: Listener) => {
          (mapListeners[ev] ||= []).push(fn);
        };
        this.getCenter = () => ({ lat: () => 37.7749, lng: () => -122.4194 });
        this.getBounds = () => ({
          getNorthEast: () => ({ lat: () => 38, lng: () => -122.2 }),
          getSouthWest: () => ({ lat: () => 37.6, lng: () => -122.6 }),
        });
        this.panTo = () => {};
        this.setZoom = () => {};
      },
      Marker: function (this: any, o: Record<string, unknown>) {
        const self: StubMarker = {
          opts: o,
          map: o.map,
          icon: o.icon as Record<string, unknown>,
          listeners: {},
          setMap(m) {
            this.map = m;
          },
          setIcon(i) {
            this.icon = i;
          },
          addListener(ev, fn) {
            (this.listeners[ev] ||= []).push(fn);
          },
        };
        markers.push(self);
        return self;
      },
      Size: function (this: any, w: number, h: number) {
        this.width = w;
        this.height = h;
      },
      Point: function (this: any, x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    },
  };

  if (withClusterer) {
    clusterer = { added: [], cleared: 0 };
    win.markerClusterer = {
      MarkerClusterer: function (this: any) {
        this.addMarkers = (ms: unknown[]) => {
          if (clustererThrowsOnAdd) throw new Error('clusterer boom');
          clusterer!.added.push(ms);
        };
        this.clearMarkers = () => {
          clusterer!.cleared++;
        };
      },
    };
  }

  win.initMap();
  return { win, dom, markers, messages, mapListeners, clusterer };
}

const marker = (i: number, slug = 'dining', extra: Record<string, unknown> = {}) => ({
  id: `e${i}`,
  lat: 37.77 + i * 0.01,
  lng: -122.41 + i * 0.01,
  title: `Event ${i}`,
  categorySlug: slug,
  ...extra,
});

describe('Google page boots', () => {
  it('exposes the same API the Leaflet page does', () => {
    const { win } = boot();
    expect(typeof win.__updateMarkers).toBe('function');
    expect(typeof win.__updateActiveMarker).toBe('function');
    expect(win.__map).toBeTruthy();
  });

  it('reports mapReady', () => {
    const { messages } = boot();
    expect(messages.some((m) => m.type === 'mapReady')).toBe(true);
  });

  it('embeds the API key and the callback', () => {
    const html = buildMapHtml('ABC123', { lat: 1, lng: 2 }, 12, false, false, false, true);
    expect(html).toContain('key=ABC123');
    expect(html).toContain('callback=initMap');
  });
});

describe('markers', () => {
  it('creates one marker per entry', () => {
    const { win, markers } = boot();
    win.__updateMarkers([marker(1), marker(2), marker(3)], '');
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.opts.title)).toEqual(['Event 1', 'Event 2', 'Event 3']);
  });

  it('skips entries with unusable coordinates', () => {
    const { win, markers } = boot();
    win.__updateMarkers(
      [
        marker(1),
        { ...marker(2), lat: NaN },
        { ...marker(3), lng: 'not-a-number' },
        { ...marker(4), lat: null },
        { ...marker(5), lat: undefined },
      ],
      ''
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].opts.title).toBe('Event 1');
    expect(Number.isFinite((markers[0].opts.position as any).lat)).toBe(true);
  });

  it('parses string coordinates', () => {
    const { win, markers } = boot();
    win.__updateMarkers([{ ...marker(1), lat: '37.5', lng: '-122.5' }], '');
    expect((markers[0].opts.position as any).lat).toBe(37.5);
    expect((markers[0].opts.position as any).lng).toBe(-122.5);
  });

  it('builds a category-coloured icon at the 44pt size', () => {
    const { win, markers } = boot();
    win.__updateMarkers([marker(1, 'nightlife')], '');
    const icon = markers[0].icon;
    expect(String(icon.url)).toMatch(/^data:image\/svg\+xml/);
    const decoded = decodeURIComponent(String(icon.url).split(',')[1]);
    expect(decoded).toContain(CATEGORY_COLORS.nightlife);
    expect((icon.scaledSize as any).width).toBe(MARKER_SIZE);
    expect((icon.anchor as any).x).toBe(MARKER_SIZE / 2);
  });

  it('replaces the previous set rather than accumulating', () => {
    const { win, markers } = boot();
    win.__updateMarkers([marker(1), marker(2)], '');
    const firstBatch = markers.slice();
    win.__updateMarkers([marker(3)], '');
    // Old markers detached from the map.
    expect(firstBatch.every((m) => m.map === null)).toBe(true);
  });

  it('handles an empty set', () => {
    const { win, markers } = boot();
    win.__updateMarkers([marker(1)], '');
    expect(() => win.__updateMarkers([], '')).not.toThrow();
    expect(markers[0].map).toBe(null);
  });

  it('emits markerPress with the event id when tapped', () => {
    const { win, markers, messages } = boot({ hasMarkerPress: true });
    win.__updateMarkers([marker(7)], '');
    markers[0].listeners.click[0]();
    expect(messages.find((m) => m.type === 'markerPress')?.eventId).toBe('e7');
  });

  it('wires no click handler when the host passes no onMarkerPress', () => {
    const { win, markers } = boot({ hasMarkerPress: false });
    win.__updateMarkers([marker(1)], '');
    expect(markers[0].listeners.click).toBeUndefined();
  });
});

describe('clustering', () => {
  it('routes markers through the clusterer when available', () => {
    const { win, markers, clusterer } = boot({ withClusterer: true });
    win.__updateMarkers([marker(1), marker(2)], '');
    expect(clusterer!.added).toHaveLength(1);
    expect(clusterer!.added[0]).toHaveLength(2);
    // Not added to the map directly.
    expect(markers.every((m) => m.opts.map === null)).toBe(true);
  });

  it('clears the clusterer between updates', () => {
    const { win, clusterer } = boot({ withClusterer: true });
    win.__updateMarkers([marker(1)], '');
    win.__updateMarkers([marker(2)], '');
    expect(clusterer!.cleared).toBeGreaterThan(0);
  });

  it('falls back to plain markers when the clusterer script never loaded', () => {
    const { win, markers } = boot({ withClusterer: false });
    win.__updateMarkers([marker(1), marker(2)], '');
    expect(markers).toHaveLength(2);
    expect(markers.every((m) => m.opts.map !== null)).toBe(true);
  });

  it('recovers if the clusterer throws while adding', () => {
    const { win, markers } = boot({ withClusterer: true, clustererThrowsOnAdd: true });
    expect(() => win.__updateMarkers([marker(1), marker(2)], '')).not.toThrow();
    // Each marker re-attached directly to the map.
    expect(markers.every((m) => m.map !== null)).toBe(true);
  });
});

describe('active marker', () => {
  it('repaints icons without recreating markers', () => {
    const { win, markers } = boot();
    win.__updateMarkers([marker(1), marker(2)], '');
    const before = markers.length;
    const firstIcon = markers[0].icon.url;
    win.__updateActiveMarker('e1');
    expect(markers).toHaveLength(before);
    expect(markers[0].icon.url).not.toBe(firstIcon);
  });

  it('marks exactly one marker active', () => {
    const { win, markers } = boot();
    win.__updateMarkers([marker(1), marker(2), marker(3)], '');
    win.__updateActiveMarker('e2');
    const activeFlags = markers.map((m) =>
      decodeURIComponent(String(m.icon.url).split(',')[1]).includes('stroke-width="3"')
    );
    expect(activeFlags.filter(Boolean)).toHaveLength(1);
    expect(activeFlags[1]).toBe(true);
  });

  it('tolerates an unknown id', () => {
    const { win } = boot();
    win.__updateMarkers([marker(1)], '');
    expect(() => win.__updateActiveMarker('nope')).not.toThrow();
  });
});

describe('message contract', () => {
  it('emits regionChange with centre and bounds on idle', () => {
    const { messages, mapListeners } = boot({ hasRegionChange: true });
    mapListeners.idle[0]();
    const region = messages.find((m) => m.type === 'regionChange');
    expect(region).toMatchObject({ lat: 37.7749, lng: -122.4194 });
    expect(region!.bounds).toEqual({
      ne: { lat: 38, lng: -122.2 },
      sw: { lat: 37.6, lng: -122.6 },
    });
  });

  it('registers no idle listener when the host passes no onRegionChange', () => {
    const { mapListeners } = boot({ hasRegionChange: false });
    expect(mapListeners.idle).toBeUndefined();
  });

  it('emits mapPress only when selectable', () => {
    const on = boot({ selectable: true });
    on.mapListeners.click[0]({ latLng: { lat: () => 1, lng: () => 2 } });
    expect(on.messages.find((m) => m.type === 'mapPress')).toMatchObject({ lat: 1, lng: 2 });

    const off = boot({ selectable: false });
    expect(off.mapListeners.click).toBeUndefined();
  });
});

describe('hostile marker data', () => {
  it('does not execute injected markup in a title', () => {
    const { win, markers, dom } = boot();
    win.__updateMarkers([marker(1, 'dining', { title: '<img src=x onerror=alert(1)>' })], '');
    expect(markers[0].opts.title).toBe('<img src=x onerror=alert(1)>');
    expect(dom.window.document.querySelectorAll('img')).toHaveLength(0);
  });

  it('survives quotes and backslashes in the title', () => {
    const { win, markers } = boot();
    const title = `O'Brien's "Pub" \\ Grill`;
    win.__updateMarkers([marker(1, 'dining', { title })], '');
    expect(markers[0].opts.title).toBe(title);
  });

  it('falls back to the default pin for an unknown category', () => {
    const { win, markers } = boot();
    win.__updateMarkers([marker(1, 'no-such-category')], '');
    expect(String(markers[0].icon.url)).toMatch(/^data:image\/svg\+xml/);
  });

  it('handles a large marker set', () => {
    const { win, markers } = boot();
    const many = Array.from({ length: 500 }, (_, i) => marker(i));
    expect(() => win.__updateMarkers(many, '')).not.toThrow();
    expect(markers).toHaveLength(500);
  });
});
