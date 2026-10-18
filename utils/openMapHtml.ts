import { leafletCss, leafletJs } from './leaflet.generated';

export function buildOpenMapHtml(center: { lat: number; lng: number }, zoom: number, gestures: boolean, attributionTop = 0) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${leafletCss} html,body,#map{width:100%;height:100%;margin:0} ${attributionTop ? `.leaflet-bottom.leaflet-right{bottom:auto;top:${attributionTop}px}` : ''} .event-pin{border:2px solid white;border-radius:50%;background:#b41924;box-shadow:0 1px 5px #555} .event-pin.active{background:#2d8a6e;border-color:#222}</style>
  </head><body><div id="map"></div><script>${leafletJs.replace(/<\/script/gi, '<\\/script')}</script><script>
  function emit(data){var message=JSON.stringify(data);if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(message)}else{window.parent.postMessage(message,'*')}}
  var map=L.map('map',{zoomControl:false,dragging:${gestures},scrollWheelZoom:${gestures},doubleClickZoom:${gestures},touchZoom:${gestures},boxZoom:${gestures},keyboard:${gestures}}).setView([${center.lat},${center.lng}],${zoom});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  window.__map={panTo:function(c){map.panTo([c.lat,c.lng])},setZoom:function(z){map.setZoom(z)}};
  var markers=[];
  function icon(active){return L.divIcon({className:'event-pin'+(active?' active':''),iconSize:[22,22],iconAnchor:[11,11]})}
  window.__updateActiveMarker=function(id){markers.forEach(function(m){m.marker.setIcon(icon(m.id===id))})};
  window.__updateMarkers=function(data,active){markers.forEach(function(m){map.removeLayer(m.marker)});markers=[];data.forEach(function(m){var marker=L.marker([m.lat,m.lng],{icon:icon(m.id===active),title:m.title||'Event',alt:m.title||'Event'}).addTo(map);var label=document.createElement('span');label.textContent=m.title||'';marker.bindTooltip(label);marker.on('click',function(){emit({type:'markerPress',eventId:m.id})});markers.push({id:m.id,marker:marker})})};
  map.on('click',function(e){emit({type:'mapPress',lat:e.latlng.lat,lng:e.latlng.lng})});
  function region(){var c=map.getCenter(),b=map.getBounds();emit({type:'regionChange',lat:c.lat,lng:c.lng,bounds:{ne:{lat:b.getNorth(),lng:b.getEast()},sw:{lat:b.getSouth(),lng:b.getWest()}}})}
  map.on('moveend',region);map.on('zoomend',region);
  emit({type:'mapReady'});region();
  </script></body></html>`;
}
