import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Modal, Button, toast, useTranslations } from '@yatracab/ui';
import { Crosshair, Loader2, MapPin } from 'lucide-react';

// Drag-the-map picker, the pattern riders already know from Uber/Ola: the pin
// stays pinned to the centre of the viewport and the map moves underneath, so
// the drop point is always dead centre and easy to nudge by a few metres.

const NOMINATIM = 'https://nominatim.openstreetmap.org';

// OSM repeats administrative names ("Ajmer, Ajmer Tehsil, Ajmer"), so strip the
// admin suffixes and drop duplicates before showing the address.
const tidyArea = (v = '') =>
  v.replace(/\s+(Municipal Corporation|Municipality|Nagar Nigam|Tehsil|District|Division)$/i, '').trim();

const shortLabel = (displayName = '') => {
  const seen = new Set();
  return displayName
    .split(',')
    .map((part) => tidyArea(part))
    .filter((part) => {
      const key = part.toLowerCase();
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .join(', ');
};

async function reverseGeocode(lat, lng, signal) {
  const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error('Lookup failed');
  const data = await res.json();
  return shortLabel(data.display_name) || 'Dropped pin';
}

export function MapPicker({ open, value, title, onClose, onConfirm }) {
  const t = useTranslations('MapPicker');
  const holderRef = useRef(null);
  const mapRef = useRef(null);
  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  const [center, setCenter] = useState(null);
  const [address, setAddress] = useState('');
  const [looking, setLooking] = useState(false);

  const lookUp = useCallback((lat, lng) => {
    clearTimeout(debounceRef.current);
    setLooking(true);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        setAddress(await reverseGeocode(lat, lng, abortRef.current.signal));
      } catch (err) {
        if (err.name !== 'AbortError') setAddress(t('droppedPin'));
      } finally {
        setLooking(false);
      }
    }, 400);
  }, []);

  // Build the map when the sheet opens, starting on the place already chosen so
  // the rider only has to nudge it.
  useEffect(() => {
    if (!open || !holderRef.current || mapRef.current) return undefined;
    const start = value?.lat != null ? [value.lat, value.lng] : [26.9124, 75.7873];
    const map = L.map(holderRef.current, { zoomControl: false, attributionControl: true }).setView(start, 17);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const sync = () => {
      const c = map.getCenter();
      setCenter({ lat: c.lat, lng: c.lng });
      lookUp(c.lat, c.lng);
    };
    map.on('moveend', sync);
    mapRef.current = map;

    setCenter({ lat: start[0], lng: start[1] });
    setAddress(value?.address || '');
    // Leaflet needs a nudge when it mounts inside a dialog that animates in.
    setTimeout(() => map.invalidateSize(), 180);

    return () => {
      map.off('moveend', sync);
      map.remove();
      mapRef.current = null;
      clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [open, value?.lat, value?.lng, value?.address, lookUp]);

  const recenterOnMe = () => {
    if (!navigator.geolocation) return toast.error(t('notSupported'));
    navigator.geolocation.getCurrentPosition(
      (pos) => mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 17),
      () => toast.error(t('couldNotLocate')),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const confirm = () => {
    if (!center) return;
    onConfirm({ address: address || t('droppedPin'), lat: center.lat, lng: center.lng });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || t('adjustDrop')}
      subtitle={t('subtitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={confirm} disabled={!center}>{t('confirmPoint')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="relative h-[340px] w-full overflow-hidden rounded-xl border border-ink-200">
          <div ref={holderRef} className="h-full w-full" />

          {/* Centre pin — sits above the map and never moves. */}
          <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
            <div className="-mt-7 flex flex-col items-center">
              <MapPin size={34} className="text-accent drop-shadow" strokeWidth={2.5} />
              <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-ink-900/40" />
            </div>
          </div>

          <button
            type="button"
            onClick={recenterOnMe}
            title={t('centreOnMe')}
            className="absolute bottom-3 left-3 z-[500] flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white shadow-card transition-colors hover:text-accent"
          >
            <Crosshair size={17} />
          </button>
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-ink-50 p-3.5 text-sm">
          <MapPin size={16} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="font-medium text-ink-900">
              {looking ? <span className="inline-flex items-center gap-1.5 text-ink-500"><Loader2 size={13} className="animate-spin" /> {t('findingAddress')}</span> : address || t('moveToChoose')}
            </p>
            {center && (
              <p className="mt-0.5 text-xs text-ink-400">
                {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
