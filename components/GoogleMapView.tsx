import { useMemo, useRef, useImperativeHandle, forwardRef, useEffect, useCallback, memo } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR } from '@/constants/categories';
import { usesGoogleMaps } from '@/services/runtime';
import { buildOpenMapHtml } from '@/utils/openMapHtml';

/** Bump when changing map icon logic or HTML structure to force WebView reload */
const MAP_HTML_VERSION = 5;

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

function buildMapHtml(
  apiKey: string,
  center: { lat: number; lng: number },
  zoom: number,
  selectable: boolean,
  hasMarkerPress: boolean,
  hasRegionChange: boolean,
  mapGesturesEnabled: boolean
) {
  const clickHandler = selectable
    ? `
      map.addListener('click', function(e) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'mapPress',
            lat: e.latLng.lat(),
            lng: e.latLng.lng()
          }));
        }
      });`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; }
    html, body, #map { height: 100%; width: 100%; font-family: 'Inter', sans-serif; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    if (!window.ReactNativeWebView) {
      window.ReactNativeWebView = { postMessage: function(message) { window.parent.postMessage(message, '*'); } };
    }
    var categoryColors = ${JSON.stringify(CATEGORY_COLORS)};
    var defaultColor = ${JSON.stringify(DEFAULT_CATEGORY_COLOR)};
    function circumIcon(paths, color, iconStroke, iconStrokeW, bgStroke) {
      var circle = '<circle cx="16" cy="16" r="14" fill="#ffffff" stroke="' + bgStroke + '" stroke-width="2"/>';
      var inner = Array.isArray(paths) ? paths.map(function(p) { return '<path d="' + p + '" fill="' + color + '" stroke="' + iconStroke + '" stroke-width="' + iconStrokeW + '" stroke-linejoin="round"/>'; }).join('') : '<path d="' + paths + '" fill="' + color + '" stroke="' + iconStroke + '" stroke-width="' + iconStrokeW + '" stroke-linejoin="round"/>';
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' + circle + '<g transform="translate(4,4)">' + inner + '</g></svg>';
    }
    function getCategoryMarkerSvg(slug, isActive) {
      var color = (slug && categoryColors[slug]) ? categoryColors[slug] : defaultColor;
      var bgStroke = isActive ? '#1a1a1a' : 'rgba(0,0,0,0.35)';
      var iconStroke = '#1a1a1a';
      var iconStrokeW = 1.2;
      var svg = '';
      if (slug === 'nightlife') {
        var disc3 = ['M12 2 A10 10 0 0 1 22 12 A10 10 0 0 1 12 22 A10 10 0 0 1 2 12 A10 10 0 0 1 12 2','M6 12c0-1.7.7-3.2 1.8-4.2','M12 10 A2 2 0 0 1 14 12 A2 2 0 0 1 12 14 A2 2 0 0 1 10 12 A2 2 0 0 1 12 10','M18 12c0 1.7-.7 3.2-1.8 4.2'];
        svg = circumIcon(disc3, color, iconStroke, iconStrokeW, bgStroke);
      } else if (slug === 'live-music') {
        var micVocal = ['m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12','M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5','M16 7m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0'];
        svg = circumIcon(micVocal, color, iconStroke, iconStrokeW, bgStroke);
      } else if (slug === 'coffee' || slug === 'cafe' || slug === 'food-drink') {
        var coffee = ['M10 2v2','M14 2v2','M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1','M6 2v2'];
        svg = circumIcon(coffee, color, iconStroke, iconStrokeW, bgStroke);
      } else if (slug === 'dining') {
        var utensils = ['m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8','M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7','m2.1 21.8 6.4-6.3','m19 5-7 7'];
        svg = circumIcon(utensils, color, iconStroke, iconStrokeW, bgStroke);
      } else if (slug === 'fitness') {
        svg = circumIcon('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z', color, iconStroke, iconStrokeW, bgStroke);
      } else if (slug === 'sports') {
        var trophy = ['M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978','M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978','M18 9h1.5a1 1 0 0 0 0-5H18','M4 22h16','M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z','M6 9H4.5a1 1 0 0 1 0-5H6'];
        svg = circumIcon(trophy, color, iconStroke, iconStrokeW, bgStroke);
      } else if (slug === 'culture') {
        var palette = ['M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z','M13.5 6.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0','M17.5 10.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0','M6.5 12.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0','M8.5 7.5m-0.5 0a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0-1 0'];
        svg = circumIcon(palette, color, iconStroke, iconStrokeW, bgStroke);
      } else if (slug === 'workshops') {
        var penTool = ['M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z','m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18','m2.3 2.3 7.286 7.286','M11 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0'];
        svg = circumIcon(penTool, color, iconStroke, iconStrokeW, bgStroke);
      } else if (slug === 'markets') {
        var sparkles = ['M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z','M20 2v4','M22 4h-4','M4 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0'];
        svg = circumIcon(sparkles, color, iconStroke, iconStrokeW, bgStroke);
      } else if (slug === 'trivia') {
        var dices = ['M4 12h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z','m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6'];
        svg = circumIcon(dices, color, iconStroke, iconStrokeW, bgStroke);
      } else {
        svg = circumIcon('M12,2.06a5.5,5.5,0,0,0-.5,10.97v8.41a.5.5,0,0,0,.5.5.5.5,0,0,0,.5-.5V13.03A5.5,5.5,0,0,0,12,2.06Zm0,10a4.5,4.5,0,1,1,4.5-4.5A4.5,4.5,0,0,1,12,12.06Z', color, iconStroke, iconStrokeW, bgStroke);
      }
      var size = 32;
      return {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
        scaledSize: new google.maps.Size(size, size),
        anchor: new google.maps.Point(size / 2, size / 2)
      };
    }
    function getPinpointIcon(categorySlug, isActive) {
      return getCategoryMarkerSvg(categorySlug, isActive);
    }
    function initMap() {
      var center = { lat: ${center.lat}, lng: ${center.lng} };
      var map = new google.maps.Map(document.getElementById('map'), {
        center: center,
        zoom: ${zoom},
        disableDefaultUI: true,
        keyboardShortcuts: false,
        gestureHandling: ${mapGesturesEnabled} ? 'greedy' : 'none',
        draggable: ${mapGesturesEnabled},
        scrollwheel: ${mapGesturesEnabled},
        disableDoubleClickZoom: ${!mapGesturesEnabled},
      });
      var hasMarkerPress = ${hasMarkerPress};
      window.__markerData = [];
      window.__map = map;
      window.__updateActiveMarker = function(activeId) {
        if (!window.__markerData) return;
        window.__markerData.forEach(function(d) {
          var isActive = d.id && activeId === d.id;
          d.marker.setIcon(getPinpointIcon(d.categorySlug, isActive));
        });
      };
      window.__updateMarkers = function(markersData, activeId) {
        if (!window.__markerData) return;
        window.__markerData.forEach(function(d) { d.marker.setMap(null); });
        window.__markerData = [];
        if (!markersData || !markersData.length) return;
        markersData.forEach(function(m) {
          var lat = typeof m.lat === 'number' ? m.lat : parseFloat(m.lat);
          var lng = typeof m.lng === 'number' ? m.lng : parseFloat(m.lng);
          if (isNaN(lat) || isNaN(lng)) return;
          var pos = { lat: lat, lng: lng };
          var categorySlug = m.categorySlug || '';
          var isActive = m.id && activeId === m.id;
          var marker = new google.maps.Marker({
            position: pos,
            map: map,
            title: m.title || '',
            icon: getPinpointIcon(categorySlug, isActive)
          });
          window.__markerData.push({ marker: marker, id: m.id, categorySlug: categorySlug });
          if (hasMarkerPress && m.id) {
            marker.addListener('click', function() {
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'markerPress', eventId: m.id }));
              }
            });
          }
        });
      };
      if (${hasRegionChange}) {
        map.addListener('idle', function() {
          var c = map.getCenter();
          var b = map.getBounds();
          if (c && window.ReactNativeWebView) {
            var payload = { type: 'regionChange', lat: c.lat(), lng: c.lng() };
            if (b) {
              var ne = b.getNorthEast();
              var sw = b.getSouthWest();
              payload.bounds = { ne: { lat: ne.lat(), lng: ne.lng() }, sw: { lat: sw.lat(), lng: sw.lng() } };
            }
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
          }
        });
      }
      ${clickHandler}
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
      }
    }
  </script>
  <script async defer src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap"></script>
</body>
</html>`;
}

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
        if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
        return { ...m, lat, lng };
      })
      .filter((m): m is MapMarker => m != null);
  }, [markers]);

  const html = useMemo(
    () =>
      usesGoogleMaps ? buildMapHtml(
        apiKey,
        center,
        zoom,
        !!onMapPress,
        !!onMarkerPress,
        !!onRegionChange,
        mapGesturesEnabled
      ) : buildOpenMapHtml(center, zoom, mapGesturesEnabled, onRegionChange ? 180 : 0),
    [apiKey, center.lat, center.lng, zoom, !!onMapPress, !!onMarkerPress, !!onRegionChange, mapGesturesEnabled, MAP_HTML_VERSION]
  );

  const webViewRef = useRef<WebView>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const injectJavaScript = useCallback((script: string) => {
    if (Platform.OS === 'web') {
      const frame = iframeRef.current;
      const doc = frame?.contentDocument;
      if (doc) {
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
  const lastInjectedIdsRef = useRef<string>('');
  const lastInjectedActiveRef = useRef<string>('');
  validMarkersRef.current = validMarkers;
  activeMarkerIdRef.current = activeMarkerId;

  const injectMarkers = useCallback(() => {
    const markers = validMarkersRef.current;
    const activeId = activeMarkerIdRef.current ?? '';
    const idsKey = markers
      .map((m) => m.id)
      .sort()
      .join(',');
    const idsChanged = idsKey !== lastInjectedIdsRef.current;
    const activeChanged = activeId !== lastInjectedActiveRef.current;
    if (!idsChanged && !activeChanged) return;
    if (idsChanged) {
      lastInjectedIdsRef.current = idsKey;
      lastInjectedActiveRef.current = activeId;
      const markersRaw = JSON.stringify(markers);
      const markersEscaped = markersRaw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const activeRaw = JSON.stringify(activeId);
      const activeEscaped = activeRaw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const script = `(function(){if(typeof window.__updateMarkers==='function'){try{window.__updateMarkers(JSON.parse('${markersEscaped}'),JSON.parse('${activeEscaped}'));}catch(e){}}}());true;`;
      injectJavaScript(script);
    } else {
      lastInjectedActiveRef.current = activeId;
      const activeEscaped = JSON.stringify(activeId).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const script = `(function(){if(typeof window.__updateActiveMarker==='function'){try{window.__updateActiveMarker(JSON.parse('${activeEscaped}'));}catch(e){}}}());true;`;
      injectJavaScript(script);
    }
  }, []);

  const animateTo = (lat: number, lng: number, zoom?: number) => {
    const zoomPart = typeof zoom === 'number' ? `m.setZoom(${zoom});` : '';
    injectJavaScript(
      `(function(){var m=window.__map;if(m){m.panTo({lat:${lat},lng:${lng}});${zoomPart}}})();true;`
    );
  };

  useEffect(() => {
    injectMarkers();
  }, [validMarkers, activeMarkerId, injectMarkers]);

  useImperativeHandle(ref, () => ({ animateTo }), []);

  const handleMessage = useCallback((data: string) => {
    try {
      const payload = JSON.parse(data);
      if (payload.type === 'mapReady') {
        lastInjectedIdsRef.current = '';
        lastInjectedActiveRef.current = '__none__';
        injectMarkers();
      } else if (payload.type === 'mapPress') {
        onMapPress?.(payload.lat, payload.lng);
      } else if (payload.type === 'markerPress') {
        onMarkerPress?.(payload.eventId);
      } else if (payload.type === 'regionChange') {
        onRegionChange?.(payload);
      }
    } catch { /* Discard unrelated frame messages. */ }
  }, [injectMarkers, onMapPress, onMarkerPress, onRegionChange]);

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
        cacheEnabled={false}
        scrollEnabled={webViewScrollEnabled}
        nestedScrollEnabled={nestedScrollEnabledProp}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        applicationNameForUserAgent="EventMap/1.0"
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data);
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
              lastInjectedIdsRef.current = '';
              lastInjectedActiveRef.current = '__none__';
              injectMarkers();
            }
          } catch {
            // ignore
          }
        }}
      />
      )}
    </View>
  );
});

export const GoogleMapView = memo(GoogleMapViewInner);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 300,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
