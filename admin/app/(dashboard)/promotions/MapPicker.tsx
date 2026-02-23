'use client';

import { useEffect, useRef, useState } from 'react';

type MapPickerProps = {
  initialLat?: number | null;
  initialLng?: number | null;
  onSelect: (lat: number, lng: number) => void;
  height?: number;
};

export function MapPicker({
  initialLat,
  initialLng,
  onSelect,
  height = 300,
}: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  const lat = initialLat ?? 13.7563;
  const lng = initialLng ?? 100.5018;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let L: any;
    let map: any;
    let marker: any;

    const init = async () => {
      L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled) return;

      // Use a fresh inner div so we never hit "container already initialized" (React Strict Mode)
      const inner = document.createElement('div');
      inner.style.height = '100%';
      inner.style.width = '100%';
      container.innerHTML = '';
      container.appendChild(inner);

      map = L.map(inner).setView([lat, lng], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      // Use circleMarker instead of marker - no image assets, avoids 404s in Next.js
      marker = L.circleMarker([lat, lng], {
        radius: 10,
        fillColor: '#3b82f6',
        color: '#1d4ed8',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8,
      }).addTo(map);

      map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
        const { lat: newLat, lng: newLng } = e.latlng;
        marker.setLatLng([newLat, newLng]);
        onSelect(newLat, newLng);
      });

      if (cancelled) {
        map?.remove();
        return;
      }
      mapRef.current = map;
      markerRef.current = marker;
      setReady(true);
    };

    init();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready && markerRef.current && (initialLat != null || initialLng != null)) {
      markerRef.current.setLatLng([initialLat ?? lat, initialLng ?? lng]);
    }
  }, [ready, initialLat, initialLng, lat, lng]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        Click on the map to set the center for radius targeting
      </p>
      <div
        ref={containerRef}
        className="w-full rounded-md border border-zinc-300 overflow-hidden"
        style={{ height: `${height}px` }}
      />
    </div>
  );
}
