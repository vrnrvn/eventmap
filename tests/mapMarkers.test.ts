import { describe, it, expect } from 'vitest';
import { markerStateKey, type MarkerKeyInput } from '@/utils/mapMarkers';

/**
 * Mirrors the dedupe decision in GoogleMapView.injectMarkers so the regression
 * is pinned at the level that actually matters: which injections reach the
 * WebView. 'full' rebuilds the marker set, 'active-only' just repaints the
 * highlighted pin, 'none' is skipped.
 */
function injectionsFor(frames: { markers: MarkerKeyInput[]; activeId?: string }[]) {
  let lastMarkers = '';
  let lastActive = '__none__'; // post-mapReady reset
  return frames.map(({ markers, activeId = '' }) => {
    const key = markerStateKey(markers);
    const markersChanged = key !== lastMarkers;
    const activeChanged = activeId !== lastActive;
    if (!markersChanged && !activeChanged) return 'none';
    if (markersChanged) {
      lastMarkers = key;
      lastActive = activeId;
      return 'full';
    }
    lastActive = activeId;
    return 'active-only';
  });
}

describe('markerStateKey', () => {
  it('is order-independent', () => {
    const a = [
      { id: 'e1', lat: 1, lng: 2 },
      { id: 'e2', lat: 3, lng: 4 },
    ];
    expect(markerStateKey(a)).toBe(markerStateKey([...a].reverse()));
  });

  it('changes when a marker moves', () => {
    expect(markerStateKey([{ id: 'x', lat: 1, lng: 2 }])).not.toBe(
      markerStateKey([{ id: 'x', lat: 1, lng: 3 }])
    );
  });

  it('changes when a category changes', () => {
    expect(markerStateKey([{ id: 'x', lat: 1, lng: 2, categorySlug: 'dining' }])).not.toBe(
      markerStateKey([{ id: 'x', lat: 1, lng: 2, categorySlug: 'nightlife' }])
    );
  });

  it('treats a missing category as empty rather than throwing', () => {
    expect(markerStateKey([{ id: 'x', lat: 1, lng: 2 }])).toBe(
      markerStateKey([{ id: 'x', lat: 1, lng: 2, categorySlug: undefined }])
    );
  });

  it('does not alias distinct sets whose ids contain the delimiters', () => {
    expect(markerStateKey([{ id: 'a@1', lat: 2, lng: 3 }])).not.toBe(
      markerStateKey([{ id: 'a', lat: 1, lng: 2 }])
    );
    expect(markerStateKey([{ id: 'a|b', lat: 1, lng: 2 }])).not.toBe(
      markerStateKey([
        { id: 'a', lat: 1, lng: 2 },
        { id: 'b', lat: 1, lng: 2 },
      ])
    );
  });

  it('is stable for an empty set', () => {
    expect(markerStateKey([])).toBe('');
  });
});

describe('injection behaviour', () => {
  it('re-injects a fixed-id marker that moves (location pickers)', () => {
    // AddressMapPicker / business-location / HostSetup all keep the id
    // constant and change lat/lng. The old id-only key produced
    // ['full','none','none'] here — the pin stayed at the first position while
    // the map panned away.
    expect(
      injectionsFor([
        { markers: [{ id: 'business', lat: 37.7749, lng: -122.4194 }] },
        { markers: [{ id: 'business', lat: 37.8044, lng: -122.2712 }] },
        { markers: [{ id: 'business', lat: 40.7128, lng: -74.006 }] },
      ])
    ).toEqual(['full', 'full', 'full']);
  });

  it('still dedupes repeat renders with equal marker state', () => {
    const m = { id: 'e1', lat: 1, lng: 2, categorySlug: 'dining' };
    expect(
      injectionsFor([{ markers: [m] }, { markers: [{ ...m }] }, { markers: [{ ...m }] }])
    ).toEqual(['full', 'none', 'none']);
  });

  it('keeps marker taps on the cheap active-only path', () => {
    // Selecting a pin must not trigger a full marker rebuild.
    const markers = [
      { id: 'e1', lat: 1, lng: 2, categorySlug: 'dining' },
      { id: 'e2', lat: 3, lng: 4, categorySlug: 'sports' },
    ];
    expect(
      injectionsFor([
        { markers, activeId: '' },
        { markers, activeId: 'e1' },
        { markers, activeId: 'e2' },
        { markers, activeId: 'e2' },
      ])
    ).toEqual(['full', 'active-only', 'active-only', 'none']);
  });

  it('rebuilds when the discover result set changes', () => {
    expect(
      injectionsFor([
        { markers: [{ id: 'e1', lat: 1, lng: 2 }] },
        {
          markers: [
            { id: 'e1', lat: 1, lng: 2 },
            { id: 'e2', lat: 3, lng: 4 },
          ],
        },
        { markers: [{ id: 'e2', lat: 3, lng: 4 }] },
        { markers: [] },
      ])
    ).toEqual(['full', 'full', 'full', 'full']);
  });
});
