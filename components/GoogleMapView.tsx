import { useMemo, useRef, useImperativeHandle, forwardRef, useEffect, useCallback, memo, useState } from 'react';
import { StyleSheet, Text, View, Platform } from 'react-native';
import { Colors, Typography } from '@/constants/theme';
import { WebView } from 'react-native-webview';
import { buildMapHtml } from '@/utils/googleMapHtml';
import { usesGoogleMaps } from '@/services/runtime';
import { buildOpenMapHtml } from '@/utils/openMapHtml';
import { markerStateKey } from '@/utils/mapMarkers';
import {
  buildActiveMarkerInjection,
  buildAnimateToInjection,
  buildMarkersInjection,
} from '@/utils/webviewInject';

/** Bump when changing map icon logic or HTML structure to force WebView reload */
const MAP_HTML_VERSION = 9;

export type GoogleMapHandle = {
  animateTo: (lat: number, lng: number, zoom?: number) => void;
};

type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  categorySlug?: string;
  coverImageUrl?: string | null;
  businessLogoUrl?: string | null;
  businessName?: string;
};

type GoogleMapViewProps = {
  center: { lat: number; lng: number };
  zoom?: number;
  markers?: MapMarker[];
  activeMarkerId?: string | null;
  style?: object;
  onMapPress?: (lat: number, lng: number) => void;
  onMarkerPress?: (eventId: string) => void;
  onMarkerDetailsPress?: (eventId: string) => void;
  onRegionChange?: (region: {
    lat: number;
    lng: number;
    bounds?: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } };
  }) => void;
  /** Pass false on embedded read-only maps so parent ScrollView scrolls instead of the WebView. */
  webViewScrollEnabled?: boolean;
  nestedScrollEnabled?: boolean;
  /** When false, the map cannot be panned or zoomed (static preview). Default true. */
  mapGesturesEnabled?: boolean;
};

const GoogleMapViewInner = forwardRef<GoogleMapHandle, GoogleMapViewProps>(function GoogleMapView({
  center,
  zoom = 12,
  markers = [],
  activeMarkerId = null,
  style,
  onMapPress,
  onMarkerPress,
  onMarkerDetailsPress,
  onRegionChange,
  webViewScrollEnabled = true,
  nestedScrollEnabled: nestedScrollEnabledProp = true,
  mapGesturesEnabled = true,
}, ref) {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

  const validMarkers = useMemo(() => {
    return markers
      .map((m) => {
        const lat = typeof m.lat === 'number' ? m.lat : parseFloat(String(m.lat));
        const lng = typeof m.lng === 'number' ? m.lng : parseFloat(String(m.lng));
        // isFinite, not !isNaN: Infinity passed the old check and then made
        // Leaflet throw mid-render, which cleared the marker array and left the
        // map blank.
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { ...m, lat, lng };
      })
      .filter((m): m is MapMarker => m != null);
  }, [markers]);

  // The HTML is built once with the initial center/zoom; later center changes
  // pan the existing map via injected JS instead of reloading the WebView
  // (a reload would redownload the Maps SDK and flash the whole map).
  const initialCenterRef = useRef(center);
  const initialZoomRef = useRef(zoom);
  const html = useMemo(
    () =>
      usesGoogleMaps ? buildMapHtml(
        apiKey,
        initialCenterRef.current,
        initialZoomRef.current,
        !!onMapPress,
        !!onMarkerPress,
        !!onRegionChange,
        mapGesturesEnabled
      ) : buildOpenMapHtml(initialCenterRef.current, initialZoomRef.current, mapGesturesEnabled, onRegionChange ? 180 : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiKey, !!onMapPress, !!onMarkerPress, !!onRegionChange, mapGesturesEnabled, MAP_HTML_VERSION]
  );

  const webViewRef = useRef<WebView>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // The page reported it can't show map imagery (tiles failing, or the
  // Google SDK unreachable): show a small overlay instead of a silent blank.
  const [unavailable, setUnavailable] = useState<'tiles' | 'map' | null>(null);
  const injectJavaScript = useCallback((script: string) => {
    if (Platform.OS === 'web') {
      const frame = iframeRef.current;
      const doc = frame?.contentDocument;
      // The frame can exist before its document has a body (first load on a
      // fresh browser). Skip then: mapReady re-injects markers and centre.
      // Throwing here unmounted the whole app (a blank page).
      if (doc?.body) {
        const element = doc.createElement('script');
        element.textContent = script;
        doc.body.appendChild(element);
        element.remove();
      }
    } else {
      webViewRef.current?.injectJavaScript(script);
    }
  }, []);
  const validMarkersRef = useRef(validMarkers);
  const activeMarkerIdRef = useRef(activeMarkerId);
  const lastInjectedMarkersRef = useRef<string>('');
  const lastInjectedActiveRef = useRef<string>('');
  validMarkersRef.current = validMarkers;
  activeMarkerIdRef.current = activeMarkerId;

  const injectMarkers = useCallback(() => {
    const markers = validMarkersRef.current;
    const activeId = activeMarkerIdRef.current ?? '';
    const markersKey = markerStateKey(markers);
    const markersChanged = markersKey !== lastInjectedMarkersRef.current;
    const activeChanged = activeId !== lastInjectedActiveRef.current;
    if (!markersChanged && !activeChanged) return;
    if (markersChanged) {
      lastInjectedMarkersRef.current = markersKey;
      lastInjectedActiveRef.current = activeId;
      injectJavaScript(buildMarkersInjection(markers, activeId));
    } else {
      lastInjectedActiveRef.current = activeId;
      injectJavaScript(buildActiveMarkerInjection(activeId));
    }
  }, [injectJavaScript]);

  const animateTo = useCallback((lat: number, lng: number, zoom?: number) => {
    const script = buildAnimateToInjection(lat, lng, zoom);
    if (script) injectJavaScript(script);
  }, [injectJavaScript]);

  useEffect(() => {
    injectMarkers();
  }, [validMarkers, activeMarkerId, injectMarkers]);

  // Recenter on center-prop changes without reloading the HTML.
  const lastCenterRef = useRef(initialCenterRef.current);
  const centerLat = center.lat;
  const centerLng = center.lng;
  useEffect(() => {
    const last = lastCenterRef.current;
    if (centerLat === last.lat && centerLng === last.lng) return;
    lastCenterRef.current = { lat: centerLat, lng: centerLng };
    animateTo(centerLat, centerLng);
  }, [centerLat, centerLng, animateTo]);

  useImperativeHandle(ref, () => ({ animateTo }), [animateTo]);

  // If the center prop moved before the map finished loading (the injected pan
  // would have been lost), re-apply it once the map reports ready.
  const recenterIfNeeded = useCallback(() => {
    const current = lastCenterRef.current;
    const initial = initialCenterRef.current;
    if (current.lat !== initial.lat || current.lng !== initial.lng) {
      animateTo(current.lat, current.lng);
    }
  }, [animateTo]);

  const handleMessage = useCallback((data: string) => {
    try {
      const payload = JSON.parse(data);
      if (payload.type === 'mapUnavailable' || payload.type === 'mapAvailable') {
        setUnavailable(payload.type === 'mapUnavailable' ? (payload.reason === 'tiles' ? 'tiles' : 'map') : null);
      } else if (payload.type === 'mapReady') {
        lastInjectedMarkersRef.current = '';
        lastInjectedActiveRef.current = '__none__';
        injectMarkers();
        recenterIfNeeded();
      } else if (payload.type === 'mapPress') {
        onMapPress?.(payload.lat, payload.lng);
      } else if (payload.type === 'markerPress') {
        onMarkerPress?.(payload.eventId);
      } else if (payload.type === 'regionChange') {
        onRegionChange?.(payload);
      }
    } catch { /* Discard unrelated frame messages. */ }
  }, [injectMarkers, recenterIfNeeded, onMapPress, onMarkerPress, onRegionChange]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const listener = (event: MessageEvent) => {
      if (event.source === iframeRef.current?.contentWindow && typeof event.data === 'string') handleMessage(event.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [handleMessage]);

  return (
    <View style={[styles.container, style]}>
      {Platform.OS === 'web' ? (
        <iframe ref={iframeRef} title="Event map" srcDoc={html}
          style={{ width: '100%', height: '100%', border: 0, flex: 1 }}
          onLoad={() => handleMessage('{"type":"mapReady"}')} />
      ) : (
      <WebView
        ref={webViewRef}
        key={`map-${MAP_HTML_VERSION}`}
        source={{ html }}
        style={styles.webview}
        // The page itself is inline HTML and can't go stale, so caching only
        // affects subresources — map tiles. Leaving it off made every map mount
        // re-download every tile it had already fetched.
        cacheEnabled
        scrollEnabled={webViewScrollEnabled}
        nestedScrollEnabled={nestedScrollEnabledProp}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        applicationNameForUserAgent="EventMap/1.0"
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data);
            if (payload?.type === 'mapUnavailable' || payload?.type === 'mapAvailable') {
              handleMessage(event.nativeEvent.data);
              return;
            }
            if (payload?.type === 'mapPress' && onMapPress && typeof payload.lat === 'number' && typeof payload.lng === 'number') {
              onMapPress(payload.lat, payload.lng);
            }
            if (payload?.type === 'markerPress' && onMarkerPress && typeof payload.eventId === 'string') {
              onMarkerPress(payload.eventId);
            }
            if (payload?.type === 'markerDetailsPress' && onMarkerDetailsPress && typeof payload.eventId === 'string') {
              onMarkerDetailsPress(payload.eventId);
            }
            if (payload?.type === 'regionChange' && onRegionChange && typeof payload.lat === 'number' && typeof payload.lng === 'number') {
              onRegionChange({
                lat: payload.lat,
                lng: payload.lng,
                bounds: payload.bounds,
              });
            }
            if (payload?.type === 'mapReady') {
              lastInjectedMarkersRef.current = '';
              lastInjectedActiveRef.current = '__none__';
              injectMarkers();
              recenterIfNeeded();
            }
          } catch {
            // ignore
          }
        }}
        // The page itself failed (rare: it's inline HTML).
        onError={() => setUnavailable('map')}
      />
      )}
      {unavailable ? (
        <View style={styles.unavailable} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={styles.unavailableText}>
            {unavailable === 'tiles'
              ? "Map images can't load right now. Pins still show."
              : "The map can't load right now. Events are still listed."}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

export const GoogleMapView = memo(GoogleMapViewInner);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 300,
  },
  unavailable: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    alignItems: 'center',
  },
  unavailableText: {
    backgroundColor: Colors.surface,
    color: Colors.text.secondary,
    fontSize: Typography.sizes.xs,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    overflow: 'hidden',
    textAlign: 'center',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
