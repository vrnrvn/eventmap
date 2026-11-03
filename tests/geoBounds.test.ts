import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
  boundsOfPoints,
  centroidOf,
  haversineKm,
  isInBounds,
  radiusKmFromBounds,
  type MapBounds,
  zoomForPoints,
} from '@/utils/geoBounds';

const SF = { lat: 37.7749, lng: -122.4194 };
const NYC = { lat: 40.7128, lng: -74.006 };

describe('haversineKm', () => {
  it('measures a known distance', () => {
    // SF→NYC is ~4130 km.
    expect(haversineKm(SF, NYC)).toBeGreaterThan(4100);
    expect(haversineKm(SF, NYC)).toBeLessThan(4160);
  });

  it('is zero for the same point and symmetric', () => {
    expect(haversineKm(SF, SF)).toBe(0);
    expect(haversineKm(SF, NYC)).toBeCloseTo(haversineKm(NYC, SF), 6);
  });

  it('handles antipodal points without NaN', () => {
    const d = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(20000);
  });
});

describe('radiusKmFromBounds', () => {
  it('falls back when bounds are unknown', () => {
    expect(radiusKmFromBounds(null)).toBe(DEFAULT_RADIUS_KM);
  });

  it('clamps to the configured range', () => {
    const tiny: MapBounds = { ne: { lat: 37.775, lng: -122.419 }, sw: { lat: 37.7749, lng: -122.4194 } };
    expect(radiusKmFromBounds(tiny)).toBe(MIN_RADIUS_KM);

    const huge: MapBounds = { ne: { lat: 60, lng: 20 }, sw: { lat: -20, lng: -120 } };
    expect(radiusKmFromBounds(huge)).toBe(MAX_RADIUS_KM);
  });

  it('returns half the viewport diagonal in between', () => {
    const bounds: MapBounds = { ne: { lat: 38.0, lng: -122.2 }, sw: { lat: 37.6, lng: -122.6 } };
    const expected = haversineKm(bounds.ne, bounds.sw) / 2;
    expect(radiusKmFromBounds(bounds)).toBeCloseTo(expected, 6);
    expect(radiusKmFromBounds(bounds)).toBeGreaterThan(MIN_RADIUS_KM);
    expect(radiusKmFromBounds(bounds)).toBeLessThan(MAX_RADIUS_KM);
  });

  it('falls back on a degenerate viewport', () => {
    const zero: MapBounds = { ne: SF, sw: SF };
    expect(radiusKmFromBounds(zero)).toBe(DEFAULT_RADIUS_KM);
    const nan: MapBounds = { ne: { lat: NaN, lng: NaN }, sw: SF };
    expect(radiusKmFromBounds(nan)).toBe(DEFAULT_RADIUS_KM);
  });
});

describe('isInBounds', () => {
  const sfView: MapBounds = { ne: { lat: 38.0, lng: -122.2 }, sw: { lat: 37.6, lng: -122.6 } };

  it('includes points inside and on the edges', () => {
    expect(isInBounds(37.7749, -122.4194, sfView)).toBe(true);
    expect(isInBounds(38.0, -122.2, sfView)).toBe(true);
    expect(isInBounds(37.6, -122.6, sfView)).toBe(true);
  });

  it('excludes points outside', () => {
    expect(isInBounds(40.7128, -74.006, sfView)).toBe(false);
    expect(isInBounds(38.5, -122.4, sfView)).toBe(false); // north
    expect(isInBounds(37.7, -121.0, sfView)).toBe(false); // east
  });

  it('handles a viewport straddling the antimeridian', () => {
    // Fiji / NZ: sw.lng (170) > ne.lng (-170).
    const dateLine: MapBounds = { ne: { lat: -16, lng: -170 }, sw: { lat: -20, lng: 170 } };
    expect(isInBounds(-18, 179, dateLine)).toBe(true); // west of the line
    expect(isInBounds(-18, -179, dateLine)).toBe(true); // east of the line
    expect(isInBounds(-18, 180, dateLine)).toBe(true); // on the line
    expect(isInBounds(-18, 100, dateLine)).toBe(false); // well outside
    expect(isInBounds(-18, 0, dateLine)).toBe(false);
  });

  it('still applies the latitude bound across the antimeridian', () => {
    const dateLine: MapBounds = { ne: { lat: -16, lng: -170 }, sw: { lat: -20, lng: 170 } };
    expect(isInBounds(10, 179, dateLine)).toBe(false);
  });
});

describe('boundsOfPoints / centroidOf', () => {
  it('returns null for an empty set', () => {
    expect(boundsOfPoints([])).toBeNull();
    expect(centroidOf([])).toBeNull();
  });

  it('brackets every point', () => {
    const pts = [
      { lat: 37.7, lng: -122.5 },
      { lat: 37.9, lng: -122.3 },
      { lat: 37.8, lng: -122.4 },
    ];
    const b = boundsOfPoints(pts)!;
    expect(b.sw).toEqual({ lat: 37.7, lng: -122.5 });
    expect(b.ne).toEqual({ lat: 37.9, lng: -122.3 });
    expect(centroidOf(pts)).toEqual({ lat: 37.8, lng: -122.4 });
  });

  it('handles a single point', () => {
    const pts = [{ lat: 10, lng: 20 }];
    expect(centroidOf(pts)).toEqual({ lat: 10, lng: 20 });
  });
});

describe('zoomForPoints', () => {
  it('falls back when there is nothing to fit', () => {
    expect(zoomForPoints([], 11)).toBe(11);
    expect(zoomForPoints([{ lat: 1, lng: 2 }], 11)).toBe(11);
  });

  it('zooms out further for a wider spread', () => {
    const tight = zoomForPoints([
      { lat: 37.77, lng: -122.42 },
      { lat: 37.79, lng: -122.4 },
    ]);
    const wide = zoomForPoints([
      { lat: 36.0, lng: -123.0 },
      { lat: 39.0, lng: -120.0 },
    ]);
    expect(tight).toBeGreaterThan(wide);
  });

  it('stays within a usable range', () => {
    const world = zoomForPoints([
      { lat: -80, lng: -179 },
      { lat: 80, lng: 179 },
    ]);
    expect(world).toBeGreaterThanOrEqual(2);
    expect(world).toBeLessThanOrEqual(15);
  });
});
