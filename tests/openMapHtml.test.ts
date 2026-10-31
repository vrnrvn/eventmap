import { describe, it, expect } from 'vitest';
import { buildOpenMapHtml } from '@/utils/openMapHtml';
import { MARKER_SIZE } from '@/constants/categoryMarkers';

/** Isolate the generated calls from the 166 KB of inlined Leaflet. */
const setView = (html: string) => html.match(/\.setView\(\[[^\]]*\],[^)]*\)/)?.[0] ?? '<none>';
const mapOpts = (html: string) => html.match(/L\.map\('map',\{[^}]*\}/)?.[0] ?? '<none>';
const WELL_FORMED = /^\.setView\(\[-?[\d.]+,-?[\d.]+\],-?[\d.]+\)$/;

// The signature is typed `number`, but these values cross a WebView boundary
// and originate in DB rows / geolocation — the guard exists for inputs that
// lie about their type at runtime, so the casts here are the point of the test.
const coerce = (lat: unknown, lng: unknown) => ({ lat, lng }) as { lat: number; lng: number };

describe('buildOpenMapHtml', () => {
  it('preserves real coordinates exactly', () => {
    const html = buildOpenMapHtml({ lat: 37.7749, lng: -122.4194 }, 15, true);
    expect(setView(html)).toBe('.setView([37.7749,-122.4194],15)');
  });

  it('falls back to finite values for unusable coordinates', () => {
    // Pre-fix these emitted `.setView([,],15)` / `[undefined,undefined]`, which
    // throws inside Leaflet and kills the whole map with no visible error.
    for (const bad of [NaN, undefined, null, '', 'abc', Infinity]) {
      const html = buildOpenMapHtml(coerce(bad, bad), 15, true);
      expect(setView(html), `input: ${String(bad)}`).toMatch(WELL_FORMED);
    }
  });

  it('coerces numeric strings instead of interpolating them raw', () => {
    const html = buildOpenMapHtml(coerce('37.7749', '-122.4194'), 15, true);
    expect(setView(html)).toBe('.setView([37.7749,-122.4194],15)');
  });

  it('neutralises script injection through coordinates', () => {
    const html = buildOpenMapHtml(coerce('0);alert(1);map.setView([0,0', 0), 15, true);
    expect(html).not.toContain('alert(1)');
    expect(setView(html)).toMatch(WELL_FORMED);
  });

  it('guards the zoom level too', () => {
    expect(setView(buildOpenMapHtml({ lat: 1, lng: 2 }, NaN as number, true))).toMatch(WELL_FORMED);
    expect(setView(buildOpenMapHtml({ lat: 1, lng: 2 }, 19, true))).toBe('.setView([1,2],19)');
  });

  it('only applies a numeric attribution offset', () => {
    const injected = buildOpenMapHtml(
      { lat: 1, lng: 2 },
      12,
      true,
      '180;}</style><script>alert(1)</script>' as unknown as number
    );
    expect(injected).not.toContain('alert(1)');
    expect(buildOpenMapHtml({ lat: 1, lng: 2 }, 12, true, 180)).toContain('top:180px');
  });

  it('emits real booleans for the gesture flags', () => {
    expect(mapOpts(buildOpenMapHtml({ lat: 1, lng: 2 }, 12, true))).toContain('dragging:true');
    expect(mapOpts(buildOpenMapHtml({ lat: 1, lng: 2 }, 12, false))).toContain('dragging:false');
    const coerced = mapOpts(buildOpenMapHtml({ lat: 1, lng: 2 }, 12, 'yes' as unknown as boolean));
    expect(coerced).toContain('dragging:true');
  });

  it('closes the inlined Leaflet script tag safely', () => {
    // leafletJs is injected into a <script> block; a literal '</script' in the
    // bundle would terminate it early and break the page.
    const html = buildOpenMapHtml({ lat: 1, lng: 2 }, 12, true);
    expect(html.match(/<script>/g)?.length).toBe(html.match(/<\/script>/g)?.length);
  });
});

describe('generated page script', () => {
  /** The app's own inline script — the last <script> block, after the vendored bundles. */
  function appScript(html: string): string {
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    return blocks[blocks.length - 1];
  }

  it('parses as valid JavaScript', () => {
    // A syntax error here kills the whole map silently — blank box, no error
    // surfaced to RN. Fragment assertions alone would not catch it.
    const source = appScript(buildOpenMapHtml({ lat: 1, lng: 2 }, 12, true));
    expect(source.length).toBeGreaterThan(0);
    expect(() => new Function(source)).not.toThrow();
  });

  it('parses for every option combination', () => {
    for (const gestures of [true, false]) {
      for (const attributionTop of [0, 180]) {
        const source = appScript(buildOpenMapHtml({ lat: 1, lng: 2 }, 12, gestures, attributionTop));
        expect(() => new Function(source), `gestures=${gestures} top=${attributionTop}`).not.toThrow();
      }
    }
  });

  it('emits balanced script tags with the vendored bundles inlined', () => {
    const html = buildOpenMapHtml({ lat: 1, lng: 2 }, 12, true);
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    // Leaflet, markercluster, app.
    expect(blocks.length).toBe(3);
  });
});

describe('Leaflet marker rendering', () => {
  const html = buildOpenMapHtml({ lat: 1, lng: 2 }, 12, true);

  it('ships the shared category marker builder', () => {
    expect(html).toContain('function __markerSvg(');
    expect(html).toContain(`var __markerSize = ${MARKER_SIZE};`);
  });

  it('sizes pins to the 44pt touch target, anchored centre', () => {
    expect(html).toContain('iconSize:[__markerSize,__markerSize]');
    expect(html).toContain('iconAnchor:[__markerSize/2,__markerSize/2]');
  });

  it('passes the category through to the icon, not a fixed colour', () => {
    // Regression: pins used to be a hardcoded red dot that ignored categorySlug.
    expect(html).toContain('icon(slug,m.id===active)');
    expect(html).toContain('categorySlug:slug');
    expect(html).not.toContain('#b41924');
  });

  it('keeps the category on each marker so active repaints stay correct', () => {
    // __updateActiveMarker re-icons every marker; without the stored slug it
    // would repaint them all as the default pin.
    expect(html).toContain('icon(m.categorySlug,m.id===id)');
  });

  it('strips Leaflet default divIcon chrome', () => {
    expect(html).toContain('.event-pin{background:transparent;border:0}');
  });

  it('still renders titles as text, never as markup', () => {
    expect(html).toContain('label.textContent=m.title');
    expect(html).not.toContain('innerHTML=m.title');
  });

  it('preserves the existing message contract', () => {
    // discover.tsx and GoogleMapView depend on these exact message shapes.
    for (const fragment of [
      "emit({type:'markerPress',eventId:m.id})",
      "emit({type:'mapPress'",
      "emit({type:'regionChange'",
      "emit({type:'mapReady'})",
      'window.__updateMarkers=',
      'window.__updateActiveMarker=',
      'window.__map=',
    ]) {
      expect(html, fragment).toContain(fragment);
    }
  });
});
