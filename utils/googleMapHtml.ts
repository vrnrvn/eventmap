import { markerSvgScript } from '@/constants/categoryMarkers';

/**
 * Google Maps page for the optional `EXPO_PUBLIC_MAP_PROVIDER=google` provider.
 * Mirrors `utils/openMapHtml.ts` (the default Leaflet page): same injected API
 * (`__updateMarkers`, `__updateActiveMarker`, `__map`) and the same message
 * contract back to React Native, so GoogleMapView drives either identically.
 *
 * Kept out of the component so it can be unit-tested without the RN/WebView
 * import chain.
 */
export function buildMapHtml(
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
    // The SDK couldn't load (offline) or the key was refused: tell the app,
    // which shows an overlay instead of a silent blank box.
    window.__mapUnavailable = function(reason) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapUnavailable', reason: reason }));
    };
    window.gm_authFailure = function() { window.__mapUnavailable('auth'); };
    ${markerSvgScript()}
    function getPinpointIcon(style, isActive) {
      var svg = __markerSvg(style, isActive);
      return {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
        scaledSize: new google.maps.Size(__markerSize, __markerSize),
        anchor: new google.maps.Point(__markerSize / 2, __markerSize / 2)
      };
    }
    function initMap() {
      var center = { lat: ${JSON.stringify(Number(center.lat))}, lng: ${JSON.stringify(Number(center.lng))} };
      var map = new google.maps.Map(document.getElementById('map'), {
        center: center,
        zoom: ${JSON.stringify(Number(zoom))},
        disableDefaultUI: true,
        keyboardShortcuts: false,
        gestureHandling: ${JSON.stringify(Boolean(mapGesturesEnabled))} ? 'greedy' : 'none',
        draggable: ${JSON.stringify(Boolean(mapGesturesEnabled))},
        scrollwheel: ${JSON.stringify(Boolean(mapGesturesEnabled))},
        disableDoubleClickZoom: ${JSON.stringify(!mapGesturesEnabled)},
      });
      var hasMarkerPress = ${JSON.stringify(Boolean(hasMarkerPress))};
      window.__markerData = [];
      window.__map = map;
      window.__updateActiveMarker = function(activeId) {
        if (!window.__markerData) return;
        window.__markerData.forEach(function(d) {
          var isActive = d.id && activeId === d.id;
          d.marker.setIcon(getPinpointIcon(d.style, isActive));
        });
      };
      window.__updateMarkers = function(markersData, activeId) {
        if (!window.__markerData) return;
        // Remember the latest payload so markers can be re-rendered clustered
        // when the (CDN-loaded) clusterer finishes loading after this call.
        window.__lastMarkersArgs = [markersData, activeId];
        if (window.__clusterer) {
          try { window.__clusterer.clearMarkers(); } catch (e) {}
        }
        window.__markerData.forEach(function(d) { d.marker.setMap(null); });
        window.__markerData = [];
        if (!markersData || !markersData.length) return;
        // Official @googlemaps/markerclusterer from CDN; if the script failed
        // to load, markers fall back to being added to the map directly.
        if (!window.__clusterer && window.markerClusterer && window.markerClusterer.MarkerClusterer) {
          try {
            window.__clusterer = new window.markerClusterer.MarkerClusterer({
              map: map,
              // Dominant category colour of the cluster (same rule as Leaflet).
              renderer: {
                render: function (c) {
                  var color = __markerDominantColor((c.markers || []).map(function (mk) { return mk.__evmStyle || null; }));
                  var label = c.count > 99 ? '99+' : String(c.count);
                  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" fill="' + color + '" stroke="#ffffff" stroke-width="3"/></svg>';
                  return new google.maps.Marker({
                    position: c.position,
                    icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(44, 44), anchor: new google.maps.Point(22, 22) },
                    label: { text: label, color: '#ffffff', fontSize: '13px', fontWeight: '700' },
                    title: c.count + ' events in this area',
                    zIndex: 1000 + c.count
                  });
                }
              }
            });
          } catch (e) { window.__clusterer = null; }
        }
        var useClusterer = !!window.__clusterer;
        var created = [];
        markersData.forEach(function(m) {
          var lat = typeof m.lat === 'number' ? m.lat : parseFloat(m.lat);
          var lng = typeof m.lng === 'number' ? m.lng : parseFloat(m.lng);
          if (isNaN(lat) || isNaN(lng)) return;
          var pos = { lat: lat, lng: lng };
          var style = { categorySlug: m.categorySlug || '', categoryColor: m.categoryColor || '', categoryIconKey: m.categoryIconKey || '' };
          var isActive = m.id && activeId === m.id;
          var marker = new google.maps.Marker({
            position: pos,
            map: useClusterer ? null : map,
            title: m.title || '',
            icon: getPinpointIcon(style, isActive)
          });
          marker.__evmStyle = style;
          created.push(marker);
          window.__markerData.push({ marker: marker, id: m.id, style: style });
          if (hasMarkerPress && m.id) {
            marker.addListener('click', function() {
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'markerPress', eventId: m.id }));
              }
            });
          }
        });
        if (useClusterer) {
          try { window.__clusterer.addMarkers(created); } catch (e) {
            window.__clusterer = null;
            created.forEach(function(marker) { marker.setMap(map); });
          }
        }
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
  <script async src="https://unpkg.com/@googlemaps/markerclusterer@2.5.3/dist/index.min.js" onload="if (window.__lastMarkersArgs && typeof window.__updateMarkers === 'function') { window.__updateMarkers(window.__lastMarkersArgs[0], window.__lastMarkersArgs[1]); }"></script>
  <script async defer src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap" onerror="window.__mapUnavailable('script')"></script>
</body>
</html>`;
}
