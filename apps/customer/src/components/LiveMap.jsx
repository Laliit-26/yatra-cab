import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair } from 'lucide-react';
import { carMarkerHtml, CAR_ASPECT } from '@yatracab/ui';

const JAIPUR = [26.9124, 75.7873];

// Accent-coloured pin (divIcon avoids Leaflet's bundler icon-path issues).
const pinIcon = L.divIcon({
  className: '',
  html: `<div style="position:relative;width:34px;height:34px">
    <div style="position:absolute;inset:0;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:linear-gradient(135deg, rgb(var(--yc-accent)), rgb(var(--yc-accent-2)));
      box-shadow:0 6px 16px -4px rgb(var(--yc-accent)/0.6)"></div>
    <div style="position:absolute;top:9px;left:9px;width:16px;height:16px;border-radius:50%;background:#fff"></div>
  </div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
});

// Shared with the ops map so both stay in step.
const CAR_W = 38;
const CAR_H = Math.round(CAR_W / CAR_ASPECT);
const carIcon = (heading = 0, active = false) =>
  L.divIcon({
    className: '',
    html: carMarkerHtml({ heading, active, size: CAR_W }),
    iconSize: [CAR_W, CAR_H],
    iconAnchor: [CAR_W / 2, CAR_H / 2],
  });

/**
 * Live OpenStreetMap panel. Centers on the user's GPS position (fallback:
 * Jaipur), drops an accent pin, and reports position changes upward.
 */
export function LiveMap({ position, onLocate, className, cars = [], focusCar = null }) {
  const holderRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const carsRef = useRef(new Map()); // id → Leaflet marker, reused across renders
  const [locating, setLocating] = useState(false);

  // Init once.
  useEffect(() => {
    if (!holderRef.current || mapRef.current) return undefined;
    const map = L.map(holderRef.current, { zoomControl: false, attributionControl: true }).setView(
      position ? [position.lat, position.lng] : JAIPUR,
      14
    );
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    markerRef.current = L.marker(position ? [position.lat, position.lng] : JAIPUR, { icon: pinIcon }).addTo(map);
    mapRef.current = map;
    // Leaflet needs a nudge when mounted inside animated/flex containers.
    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow position updates.
  useEffect(() => {
    if (!mapRef.current || !position) return;
    const ll = [position.lat, position.lng];
    markerRef.current?.setLatLng(ll);
    mapRef.current.flyTo(ll, 15, { duration: 1.2 });
  }, [position?.lat, position?.lng]);

  // Cars are diffed rather than cleared and redrawn: moving an existing marker
  // animates, while removing and re-adding makes the whole fleet flicker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set();

    cars.forEach((c) => {
      if (c?.lat == null || c?.lng == null) return;
      const id = String(c.id);
      seen.add(id);
      const ll = [c.lat, c.lng];
      const existing = carsRef.current.get(id);
      if (existing) {
        existing.setLatLng(ll);
        existing.setIcon(carIcon(c.heading || 0, c.active));
      } else {
        const m = L.marker(ll, { icon: carIcon(c.heading || 0, c.active), zIndexOffset: c.active ? 1000 : 0 }).addTo(map);
        carsRef.current.set(id, m);
      }
    });

    // Drop cars that have gone offline or out of range.
    carsRef.current.forEach((m, id) => {
      if (seen.has(id)) return;
      map.removeLayer(m);
      carsRef.current.delete(id);
    });
  }, [cars]);

  // Keep the tracked car in view during a trip.
  useEffect(() => {
    if (!mapRef.current || !focusCar?.lat) return;
    mapRef.current.panTo([focusCar.lat, focusCar.lng], { animate: true, duration: 0.8 });
  }, [focusCar?.lat, focusCar?.lng]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onLocate?.({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [onLocate]);

  return (
    <div className={`relative overflow-hidden ${className || ''}`}>
      <div ref={holderRef} className="absolute inset-0 z-0" />
      {/* Soft fade into the content below */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] h-10 bg-gradient-to-t from-ink-100 to-transparent" />
      <button
        type="button"
        onClick={locate}
        title="Center on my location"
        className="absolute bottom-4 left-4 z-[500] flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink-700 shadow-pop transition-transform hover:scale-105"
      >
        <Crosshair size={19} className={locating ? 'animate-spin text-accent' : ''} />
      </button>
    </div>
  );
}
