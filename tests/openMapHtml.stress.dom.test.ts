/**
 * Edge cases and churn against the real Leaflet page.
 * Complements openMapHtml.dom.test.ts, which covers the happy paths.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JSDOM, type DOMWindow } from 'jsdom';
import { buildOpenMapHtml } from '@/utils/openMapHtml';

type MapWindow = Window & {
  __updateMarkers: (data: unknown[], active: string) => void;
  __updateActiveMarker: (id: string) => void;
  __map: { panTo: (c: { lat: number; lng: number }) => void; setZoom: (z: number) => void };
};

let dom: JSDOM;
let win: MapWindow;

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
  await new Promise((r) => setTimeout(r, 50));
});

afterAll(() => dom?.window?.close());

const q = (sel: string) => dom.window.document.querySelectorAll(sel);
const ok = (i: number) => ({
  id: `e${i}`,
  lat: 37.7749 + i * 0.03,
  lng: -122.4194 + i * 0.03,
  title: `Event ${i}`,
  categorySlug: 'dining',
});

describe('malformed marker entries', () => {
  it('does not throw on non-finite coordinates', () => {
    expect(() =>
      win.__updateMarkers(
        [
          { ...ok(0), lat: NaN },
          { ...ok(1), lng: NaN },
          { ...ok(2), lat: Infinity },
          { ...ok(3), lat: null },
          { ...ok(4), lat: undefined },
          { ...ok(5), lat: 'abc' },
        ],
        ''
      )
    ).not.toThrow();
  });

  it('renders the valid markers in a batch that also contains bad ones', () => {
    // Regression: one Infinity coordinate used to throw mid-loop, after the
    // previous markers had been cleared — so a single bad row blanked the map.
    win.__updateMarkers(
      [ok(0), { ...ok(1), lat: Infinity }, ok(2), { ...ok(3), lng: NaN }, ok(4)],
      ''
    );
    expect(q('.event-pin').length + q('.evm-cluster').length).toBeGreaterThan(0);
  });

  it('keeps the map usable after malformed input', () => {
    win.__updateMarkers([{ ...ok(0), lat: NaN }], '');
    // A valid update after a bad one must still render.
    win.__updateMarkers([ok(1)], '');
    expect(q('.event-pin').length).toBe(1);
  });

  it('does not throw on missing fields', () => {
    expect(() =>
      win.__updateMarkers(
        [
          { id: 'a', lat: 37.77, lng: -122.41 }, // no title, no slug
          { lat: 37.78, lng: -122.42, title: 'No id' },
          { id: 'c', lat: 37.79, lng: -122.43, title: null, categorySlug: null },
        ],
        ''
      )
    ).not.toThrow();
  });

  it('handles duplicate ids without losing markers', () => {
    win.__updateMarkers([ok(0), { ...ok(0), lat: 37.82 }], '');
    expect(q('.event-pin').length + q('.evm-cluster').length).toBeGreaterThan(0);
    expect(() => win.__updateActiveMarker('e0')).not.toThrow();
  });
});

describe('extreme coordinates', () => {
  it('accepts the poles and the date line', () => {
    for (const [lat, lng] of [
      [90, 180],
      [-90, -180],
      [0, 0],
      [89.9999, 179.9999],
    ]) {
      expect(() =>
        win.__updateMarkers([{ id: 'x', lat, lng, title: 'Edge', categorySlug: 'dining' }], '')
      ).not.toThrow();
    }
  });

  it('accepts out-of-range longitudes Leaflet wraps', () => {
    expect(() =>
      win.__updateMarkers([{ id: 'x', lat: 0, lng: 540, title: 'Wrapped' }], '')
    ).not.toThrow();
  });
});

describe('churn', () => {
  it('survives rapid successive updates (fast panning)', () => {
    expect(() => {
      for (let i = 0; i < 60; i++) {
        win.__updateMarkers(
          Array.from({ length: 25 }, (_, j) => ok(j + i)),
          i % 3 === 0 ? `e${i}` : ''
        );
      }
    }).not.toThrow();
  });

  it('leaves no orphaned pins after churn', () => {
    win.__updateMarkers([ok(0), ok(1), ok(2)], '');
    win.__updateMarkers([], '');
    expect(q('.event-pin').length).toBe(0);
    expect(q('.evm-cluster').length).toBe(0);
  });

  it('alternating active updates do not accumulate DOM', () => {
    win.__updateMarkers([ok(0), ok(1), ok(2)], '');
    const before = q('.event-pin').length + q('.evm-cluster').length;
    for (let i = 0; i < 40; i++) win.__updateActiveMarker(i % 2 ? 'e0' : 'e1');
    expect(q('.event-pin').length + q('.evm-cluster').length).toBe(before);
  });

  it('handles a very long title', () => {
    const title = 'A'.repeat(10000);
    expect(() => win.__updateMarkers([{ ...ok(0), title }], '')).not.toThrow();
    expect(q('.event-pin')[0]?.getAttribute('title')).toBe(title);
  });
});

describe('map controls', () => {
  it('panTo and setZoom do not throw for valid input', () => {
    expect(() => win.__map.panTo({ lat: 40.7128, lng: -74.006 })).not.toThrow();
    expect(() => win.__map.setZoom(15)).not.toThrow();
  });

  it('keeps attribution visible', () => {
    // Required by the tile provider's terms.
    const attribution = dom.window.document.querySelector('.leaflet-control-attribution');
    expect(attribution).toBeTruthy();
    expect(attribution?.textContent ?? '').toContain('OpenStreetMap');
  });
});
