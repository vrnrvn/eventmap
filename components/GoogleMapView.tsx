import { useMemo, useRef, useImperativeHandle, forwardRef, useEffect, useCallback, memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR } from '@/constants/categories';

export type GoogleMapHandle = {
  animateTo: (lat: number, lng: number) => void;
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
};

function buildMapHtml(
  apiKey: string,
  center: { lat: number; lng: number },
  zoom: number,
  selectable: boolean,
  hasMarkerPress: boolean,
  hasRegionChange: boolean
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
    var categoryColors = ${JSON.stringify(CATEGORY_COLORS)};
    var defaultColor = ${JSON.stringify(DEFAULT_CATEGORY_COLOR)};
    function getPinpointIcon(categorySlug, isActive) {
      var color = (categorySlug && categoryColors[categorySlug]) ? categoryColors[categorySlug] : defaultColor;
      var stroke = isActive ? '#1a1a1a' : '#ffffff';
      var r = isActive ? 8 : 6;
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="' + r + '" fill="' + color + '" stroke="' + stroke + '" stroke-width="2"/></svg>';
      return {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
        scaledSize: new google.maps.Size(24, 24),
        anchor: new google.maps.Point(12, 12)
      };
    }
    function escapeHtml(s) {
      if (!s) return '';
      var div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    }
    function initMap() {
      var center = { lat: ${center.lat}, lng: ${center.lng} };
      var map = new google.maps.Map(document.getElementById('map'), {
        center: center,
        zoom: ${zoom},
        disableDefaultUI: true,
        keyboardShortcuts: false,
        gestureHandling: 'greedy'
      });
      var infoWindow = new google.maps.InfoWindow();
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
              var imgUrl = m.coverImageUrl || '';
              var eventId = m.id;
              var content = '<div class="info-window-content" data-event-id="' + escapeHtml(eventId) + '" style="padding:0;margin:0;min-width:200px;max-width:260px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.15);border-radius:8px;overflow:hidden;">' +
                (imgUrl ? '<img src="' + escapeHtml(imgUrl) + '" style="width:100%;height:120px;object-fit:cover;border-radius:8px 8px 0 0;display:block;pointer-events:none;" />' : '') +
                '<div style="padding:12px;background:#fff;border-radius:' + (imgUrl ? '0 0 8px 8px' : '8px') + ';">' +
                '<div style="font-weight:600;font-size:14px;color:#1a1a1a;margin-bottom:8px;">' + escapeHtml(m.title || 'Event') + '</div>' +
                '<div style="font-size:12px;color:#6366f1;font-weight:500;">View details →</div>' +
                '</div></div>';
              infoWindow.setContent(content);
              infoWindow.open(map, marker);
            });
          }
        });
      };
      if (hasMarkerPress) {
        google.maps.event.addListener(infoWindow, 'domready', function() {
          var el = document.querySelector('.info-window-content');
          if (el) {
            el.onclick = function() {
              var id = el.getAttribute('data-event-id');
              if (id && window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'markerDetailsPress', eventId: id }));
              }
            };
          }
        });
      }
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
      buildMapHtml(
        apiKey,
        center,
        zoom,
        !!onMapPress,
        !!onMarkerPress,
        !!onRegionChange
      ),
    [apiKey, center.lat, center.lng, zoom, !!onMapPress, !!onMarkerPress, !!onRegionChange]
  );

  const webViewRef = useRef<WebView>(null);
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
      webViewRef.current?.injectJavaScript(script);
    } else {
      lastInjectedActiveRef.current = activeId;
      const activeEscaped = JSON.stringify(activeId).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const script = `(function(){if(typeof window.__updateActiveMarker==='function'){try{window.__updateActiveMarker(JSON.parse('${activeEscaped}'));}catch(e){}}}());true;`;
      webViewRef.current?.injectJavaScript(script);
    }
  }, []);

  const animateTo = (lat: number, lng: number) => {
    webViewRef.current?.injectJavaScript(
      `(function(){var m=window.__map;if(m){m.panTo({lat:${lat},lng:${lng}});}})();true;`
    );
  };

  useEffect(() => {
    injectMarkers();
  }, [validMarkers, activeMarkerId, injectMarkers]);

  useImperativeHandle(ref, () => ({ animateTo }), []);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        key="map"
        source={{ html }}
        style={styles.webview}
        scrollEnabled
        nestedScrollEnabled
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
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
