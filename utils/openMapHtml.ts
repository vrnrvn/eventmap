import { leafletCss, leafletJs, markerClusterCss, markerClusterJs } from './leaflet.generated';
import { markerSvgScript } from '@/constants/categoryMarkers';
import { mapTileAttribution, mapTileMaxZoom, mapTileUrl } from '@/constants/mapTiles';

/** Inline scripts must not contain a literal `</script` or they terminate early. */
const inlineScript = (source: string) => source.replace(/<\/script/gi, '<\\/script');

/**
 * Cluster bubble: same visual language as the category pins (white disc, dark
 * hairline) rather than markercluster's default green/yellow blobs, and sized
 * to the same 44pt touch target.
 */
const clusterStyles = `
.evm-cluster{background:transparent;border:0}
.evm-cluster div{
  width:44px;height:44px;border-radius:22px;
  display:flex;align-items:center;justify-content:center;
  background:#ffffff;border:2px solid rgba(0,0,0,0.35);
  box-shadow:0 1px 3px rgba(0,0,0,0.4);
  font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  color:#1a1a1a;
}
.evm-cluster-lg div{font-size:13px}
`;

// Built once at module load, not per map mount: ~200 KB of constant vendor
// source that every embedded map (event page, business page, each picker) would
// otherwise re-escape and re-concatenate.
const VENDOR_SCRIPTS = `<script>${inlineScript(leafletJs)}</script><script>${inlineScript(markerClusterJs)}</script>`;
const VENDOR_STYLES = `${leafletCss} ${markerClusterCss} ${clusterStyles}`;
const MARKER_SCRIPT = markerSvgScript();

/** Coerce to a finite number before interpolating into the page script. A NaN
 * or undefined would make Leaflet throw and kill the whole map (blank box, no
 * visible error), and raw interpolation of a non-number is a script-injection
 * surface. Mirrors the Number()+JSON.stringify guard on the Google path. */
function num(value: number, fallback: number): string {
  const parsed = Number(value);
  return JSON.stringify(Number.isFinite(parsed) ? parsed : fallback);
}

export function buildOpenMapHtml(center: { lat: number; lng: number }, zoom: number, gestures: boolean, attributionTop = 0) {
  const lat = num(center.lat, 0);
  const lng = num(center.lng, 0);
  const safeZoom = num(zoom, 12);
  const gesturesOn = JSON.stringify(Boolean(gestures));
  const safeAttributionTop = Number(attributionTop);
  const attributionOffset = Number.isFinite(safeAttributionTop) ? safeAttributionTop : 0;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${VENDOR_STYLES} html,body,#map{width:100%;height:100%;margin:0} ${attributionOffset ? `.leaflet-bottom.leaflet-right{bottom:auto;top:${attributionOffset}px}` : ''}
  /* Strip Leaflet's default divIcon chrome (white box + border); the pin art is the SVG itself. */
  .event-pin{background:transparent;border:0}
  .event-pin svg{display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.4))}
  .event-pin.active{z-index:1000 !important}
  .event-pin.active svg{filter:drop-shadow(0 2px 6px rgba(0,0,0,0.55))}</style>
  </head><body><div id="map"></div>${VENDOR_SCRIPTS}<script>
  function emit(data){var message=JSON.stringify(data);if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(message)}else{window.parent.postMessage(message,'*')}}
  ${MARKER_SCRIPT}
  var map=L.map('map',{zoomControl:false,dragging:${gesturesOn},scrollWheelZoom:${gesturesOn},doubleClickZoom:${gesturesOn},touchZoom:${gesturesOn},boxZoom:${gesturesOn},keyboard:${gesturesOn}}).setView([${lat},${lng}],${safeZoom});
  L.tileLayer(${JSON.stringify(mapTileUrl)},{maxZoom:${JSON.stringify(mapTileMaxZoom)},attribution:${JSON.stringify(mapTileAttribution)},crossOrigin:true}).addTo(map);
  window.__map={panTo:function(c){map.panTo([c.lat,c.lng])},setZoom:function(z){map.setZoom(z)}};
  var markers=[];
  // 44x44 hit area with the visible disc centred inside it (see MARKER_SIZE).
  function icon(slug,active){return L.divIcon({className:'event-pin'+(active?' active':''),html:__markerSvg(slug,active),iconSize:[__markerSize,__markerSize],iconAnchor:[__markerSize/2,__markerSize/2],tooltipAnchor:[0,-__markerSize/2]})}

  // Clustering keeps dense areas legible and bounds the number of live DOM
  // pins. Falls back to plain markers if the plugin failed to evaluate.
  var clusterGroup=null;
  if (typeof L.markerClusterGroup === 'function') {
    clusterGroup = L.markerClusterGroup({
      showCoverageOnHover:false,
      maxClusterRadius:55,
      spiderfyOnMaxZoom:true,
      // Zooming all the way in on a cluster of co-located pins never separates
      // them; spiderfying at max zoom is what makes them individually tappable.
      disableClusteringAtZoom:17,
      iconCreateFunction:function(cluster){
        var count=cluster.getChildCount();
        var label=count>99?'99+':String(count);
        var cls='evm-cluster'+(count>99?' evm-cluster-lg':'');
        var a11y=count+' events in this area. Activate to zoom in.';
        return L.divIcon({
          html:'<div role="button" aria-label="'+a11y+'" title="'+a11y+'">'+label+'</div>',
          className:cls,
          iconSize:[__markerSize,__markerSize],
          iconAnchor:[__markerSize/2,__markerSize/2]
        });
      }
    });
    map.addLayer(clusterGroup);
  }
  function clearMarkers(){ if(clusterGroup){clusterGroup.clearLayers()}else{markers.forEach(function(m){map.removeLayer(m.marker)})} }

  // Icon swap only. Deliberately does NOT call clusterGroup.zoomToShowLayer to
  // surface a selection hidden inside a cluster: discover.tsx already drives
  // the viewport here (animateTo on list scroll, guarded by its programmatic-
  // move flag), and a second source of camera movement would fight it. See
  // docs/ISSUES.md for the follow-up.
  window.__updateActiveMarker=function(id){markers.forEach(function(m){m.marker.setIcon(icon(m.categorySlug,m.id===id))})};
  window.__updateMarkers=function(data,active){
    clearMarkers();
    markers=[];
    var batch=[];
    data.forEach(function(m){
      // Skip unusable coordinates rather than letting L.marker throw: the
      // exception would abort the whole loop after the old markers were
      // already cleared, leaving a blank map. Mirrors the Google page.
      var lat=typeof m.lat==='number'?m.lat:parseFloat(m.lat);
      var lng=typeof m.lng==='number'?m.lng:parseFloat(m.lng);
      if(!isFinite(lat)||!isFinite(lng))return;
      var slug=m.categorySlug||'';
      var marker=L.marker([lat,lng],{icon:icon(slug,m.id===active),title:m.title||'Event',alt:m.title||'Event',riseOnHover:true});
      // textContent, not innerHTML — event titles are user-supplied.
      var label=document.createElement('span');
      label.textContent=m.title||'';
      marker.bindTooltip(label,{direction:'top',offset:[0,0]});
      marker.on('click',function(){emit({type:'markerPress',eventId:m.id})});
      batch.push(marker);
      markers.push({id:m.id,marker:marker,categorySlug:slug});
    });
    // One bulk insert instead of N layer events.
    if(clusterGroup){clusterGroup.addLayers(batch)}else{batch.forEach(function(mk){mk.addTo(map)})}
  };
  map.on('click',function(e){emit({type:'mapPress',lat:e.latlng.lat,lng:e.latlng.lng})});
  function region(){var c=map.getCenter(),b=map.getBounds();emit({type:'regionChange',lat:c.lat,lng:c.lng,bounds:{ne:{lat:b.getNorth(),lng:b.getEast()},sw:{lat:b.getSouth(),lng:b.getWest()}}})}
  // moveend alone: Leaflet fires zoomend *and* moveend for a zoom gesture, so
  // listening to both emitted two identical regionChange messages per zoom.
  map.on('moveend',region);
  emit({type:'mapReady'});region();
  </script></body></html>`;
}
