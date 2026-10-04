import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, LocateFixed, Loader2, X, Search, Navigation2, Map } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { useTranslations } from '../i18n/I18nProvider.jsx';

// Free geocoding via OpenStreetMap Nominatim (no API key). Respect its usage
// policy: debounce requests and keep volume low. Swap for Google Places /
// Mapbox by changing only these two helpers.
const NOMINATIM = 'https://nominatim.openstreetmap.org';
// Photon (also OSM data) backs the "nearby" list — its reverse endpoint
// returns the closest named features, which Nominatim's reverse cannot.
const PHOTON = 'https://photon.komoot.io';

// Without a bias Photon searches the planet — typing "sin" returns Singapore
// and Sinaloa. Constrain to India, and narrow further to the rider's location
// when we have it.
const INDIA_BBOX = '68.1,6.5,97.4,35.7';
const COUNTRY = 'India';

const shortLabel = (displayName = '') => displayName.split(',').slice(0, 3).map((s) => s.trim()).join(', ');

// OSM stores administrative names like "Jaipur Municipal Corporation" and
// "Sanganer Tehsil". Riders just want the city.
const tidyArea = (v = '') =>
  v.replace(/\s+(Municipal Corporation|Municipality|Nagar Nigam|Tehsil|District|Division)$/i, '').trim();

// Build "Sindhi Camp, Station Road, Jaipur" from Photon's address parts.
const placeLabel = (p = {}) => {
  const where = tidyArea(p.street || p.district || p.locality || '');
  const city = tidyArea(p.city || p.county || '');
  const parts = [p.name];
  if (where && where !== p.name) parts.push(where);
  if (city && city !== p.name && city !== where) parts.push(city);
  return parts.filter(Boolean).join(', ');
};

/**
 * How well a result matches what has been typed so far. Lower is better.
 * Prefix matches win, which is what makes the list narrow alphabetically with
 * each keystroke instead of reshuffling — the Uber/Rapido behaviour.
 */
const matchRank = (name = '', query = '') => {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 3;
  if (n.startsWith(q)) return 0; // "sin" → "Sindhi Camp"
  if (n.split(/\s+/).some((w) => w.startsWith(q))) return 1; // matches any word start
  if (n.includes(q)) return 2;
  return 3;
};

/**
 * Type-ahead search via Photon. Unlike a batch geocoder it is built for
 * per-keystroke autocomplete, and `lat`/`lon` bias it towards the rider so
 * nearby places surface first.
 */
async function searchPlaces(q, signal, near) {
  const bias = near?.lat != null ? `&lat=${near.lat}&lon=${near.lng}` : '';
  const url = `${PHOTON}/api/?q=${encodeURIComponent(q)}${bias}&bbox=${INDIA_BBOX}&limit=20&lang=en`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) throw new Error('Search failed');
  const { features = [] } = await res.json();

  const seen = new Set();
  return features
    .map((f) => {
      const p = f.properties || {};
      const [lon, lat] = f.geometry?.coordinates || [];
      return {
        name: p.name || '',
        address: placeLabel(p),
        country: p.country,
        lat,
        lng: lon,
        km: near?.lat != null ? distanceKm(near.lat, near.lng, lat, lon) : null,
        rank: matchRank(p.name, q),
      };
    })
    .filter((r) => {
      if (!r.name || r.lat == null) return false;
      if (r.country && r.country !== COUNTRY) return false; // bbox still leaks neighbours
      const key = r.address.toLowerCase();
      if (seen.has(key)) return false; // Photon repeats the same place across OSM types
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      a.rank - b.rank ||                                  // closest textual match first
      (a.km ?? 1e9) - (b.km ?? 1e9) ||                    // then nearest to the rider
      a.name.localeCompare(b.name)                        // then alphabetical
    )
    .slice(0, 7);
}

async function reverseGeocode(lat, lng) {
  const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Lookup failed');
  const data = await res.json();
  return { address: shortLabel(data.display_name) || 'My location', lat, lng };
}

// Feature types worth offering as a pickup/drop point — stations, landmarks and
// localities. Everything else Photon returns (roads, shops, offices) is noise.
const NEARBY_TYPES = new Set([
  'railway:station', 'railway:halt', 'railway:subway', 'railway:tram_stop',
  'aeroway:aerodrome', 'aeroway:terminal',
  'public_transport:station', 'highway:bus_stop',
  'amenity:bus_station', 'amenity:hospital', 'amenity:place_of_worship', 'amenity:marketplace',
  'amenity:college', 'amenity:university', 'amenity:townhall', 'amenity:fuel', 'amenity:cinema',
  'tourism:hotel', 'tourism:attraction', 'tourism:museum',
  'shop:mall', 'shop:supermarket',
  'place:suburb', 'place:neighbourhood', 'place:quarter', 'place:village', 'place:town',
]);

const distanceKm = (aLat, aLng, bLat, bLng) => {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

async function nearbyPlaces(lat, lng) {
  const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&limit=50&radius=5&lang=en`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('Nearby lookup failed');
  const { features = [] } = await res.json();
  const seen = new Set();
  return features
    .map((f) => {
      const p = f.properties || {};
      const [lon, la] = f.geometry?.coordinates || [];
      return {
        name: p.name,
        area: tidyArea(p.district || p.city || p.county || ''),
        type: `${p.osm_key}:${p.osm_value}`,
        lat: la,
        lng: lon,
      };
    })
    .filter((p) => p.name && p.lat != null && NEARBY_TYPES.has(p.type))
    .filter((p) => !seen.has(p.name) && seen.add(p.name))
    .map((p) => ({ ...p, address: [p.name, p.area].filter(Boolean).join(', '), km: distanceKm(lat, lng, p.lat, p.lng) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, 6);
}

// Shared across every input on the page: one GPS fix, one nearby lookup.
let gpsPromise = null;
let nearbyPromise = null;

const GPS_TIMEOUT_MS = 10000;

// Some browsers never invoke either callback (permission prompt dismissed, or a
// device with location off). Without our own timeout the cached promise stays
// pending forever and every caller hangs, so race it and clear the cache on
// failure — a later attempt should be able to succeed.
const getPosition = () => {
  if (!gpsPromise) {
    gpsPromise = new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('unsupported'));
      const timer = setTimeout(() => reject(new Error('timeout')), GPS_TIMEOUT_MS + 500);
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        (err) => { clearTimeout(timer); reject(err); },
        { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS }
      );
    }).catch((err) => {
      gpsPromise = null; // let the rider try again
      throw err;
    });
  }
  return gpsPromise;
};

const getNearby = (coords) => {
  if (!nearbyPromise) {
    nearbyPromise = nearbyPlaces(coords.lat, coords.lng).catch(() => {
      nearbyPromise = null; // a failed lookup shouldn't stick for the session
      return [];
    });
  }
  return nearbyPromise;
};

// Loads nearby suggestions from the location permission the app already holds.
// Never prompts on its own — if permission hasn't been granted yet the panel
// offers a button that asks for it.
function useNearby() {
  const [coords, setCoords] = useState(null);
  const [places, setPlaces] = useState([]);
  const [state, setState] = useState('idle'); // idle | loading | ready | denied
  const alive = useRef(true);

  // Must re-arm on mount: React StrictMode mounts, unmounts, then remounts in
  // dev, and without this the flag stays false and every load() bails out
  // early — leaving the panel stuck on "Finding places near you…".
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const pos = await getPosition();
      const list = await getNearby(pos);
      if (!alive.current) return;
      setCoords(pos);
      setPlaces(list);
      setState('ready');
    } catch {
      if (alive.current) setState('denied');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Only auto-load when the rider has already allowed location.
      if (!navigator.permissions?.query) return load();
      try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        if (!cancelled && status.state === 'granted') load();
      } catch {
        load();
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  return { coords, places, state, load };
}

/**
 * Dynamic location picker: nearby suggestions from the rider's location,
 * type-to-search autocomplete, and "use my current location".
 * Emits { address, lat, lng } via onChange.
 */
export function LocationInput({
  value,
  onChange,
  placeholder = 'Search a place…',
  allowCurrentLocation = false,
  // Once a place is chosen, offer nearby points so the rider can pin the exact
  // spot by hand — useful for a drop, where "Ajmer" is rarely precise enough.
  refineNearby = false,
  // When provided, an "Adjust on map" button appears once a place is chosen.
  onOpenMap,
  icon: Icon = MapPin,
  onError,
}) {
  const [query, setQuery] = useState(value?.address || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const timer = useRef(null);
  const abort = useRef(null);
  const t = useTranslations('Location');
  const boxRef = useRef(null);
  const nearby = useNearby();
  const [around, setAround] = useState([]);
  const [aroundFor, setAroundFor] = useState(null);

  // Keep the text in sync when the value is set externally (e.g. popular route).
  useEffect(() => {
    setQuery(value?.address || '');
  }, [value?.address]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onDoc = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const onType = (text) => {
    setQuery(text);
    onChange?.(null); // invalidate previous selection until a new pick
    clearTimeout(timer.current);
    setOpen(true);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      abort.current?.abort();
      abort.current = new AbortController();
      setLoading(true);
      try {
        setResults(await searchPlaces(text, abort.current.signal, nearby.coords));
      } catch (err) {
        if (err.name !== 'AbortError') setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);
  };

  useEffect(() => {
    if (!refineNearby || value?.lat == null) {
      setAround([]);
      return;
    }
    const key = `${value.lat},${value.lng}`;
    if (key === aroundFor) return; // already loaded for this place
    let cancelled = false;
    nearbyPlaces(value.lat, value.lng)
      .then((list) => {
        if (cancelled) return;
        setAroundFor(key);
        setAround(list.filter((p) => p.address !== value.address));
      })
      .catch(() => !cancelled && setAround([]));
    return () => { cancelled = true; };
  }, [refineNearby, value?.lat, value?.lng, value?.address, aroundFor]);

  const pick = (place) => {
    onChange?.({ address: place.address, lat: place.lat, lng: place.lng });
    setQuery(place.address);
    setOpen(false);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return onError?.(t('notSupported'));
    setLocating(true);
    getPosition()
      .then(async (pos) => {
        try {
          pick(await reverseGeocode(pos.lat, pos.lng));
        } catch {
          pick({ address: t('myCurrentLocation'), lat: pos.lat, lng: pos.lng });
        }
      })
      .catch((err) => onError?.(err?.code === 1 ? t('permissionDenied') : t('couldNotLocate')))
      .finally(() => setLocating(false));
  };

  const selected = value?.lat != null;
  const searching = query.trim().length >= 2;

  return (
    <div className="relative" ref={boxRef}>
      <div className={cn('flex items-center gap-2 rounded-xl border bg-white px-3 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25', selected ? 'border-accent/50' : 'border-ink-200')}>
        <Icon size={17} className={cn('shrink-0', selected ? 'text-accent' : 'text-ink-400')} />
        <input
          value={query}
          onChange={(e) => onType(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="h-11 w-full bg-transparent text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
        />
        {loading && <Loader2 size={15} className="animate-spin text-ink-400" />}
        {query && !loading && (
          <button type="button" onClick={() => { setQuery(''); onChange?.(null); setResults([]); }} className="text-ink-300 hover:text-ink-500">
            <X size={15} />
          </button>
        )}
        {allowCurrentLocation && (
          <button
            type="button"
            onClick={useMyLocation}
            title={t("myCurrentLocation")}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-accent-soft px-2 py-1 text-xs font-medium text-accent transition-colors hover:brightness-95"
          >
            {locating ? <Loader2 size={13} className="animate-spin" /> : <LocateFixed size={13} />}
            <span className="hidden sm:inline">{locating ? t('locatingShort') : t('locate')}</span>
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop animate-fade-in">
          {searching ? (
            loading && results.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-ink-400"><Loader2 size={15} className="animate-spin" /> {t('searching')}</div>
            ) : results.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-ink-400"><Search size={15} /> {t('noMatches')}</div>
            ) : (
              results.map((r, i) => (
                <button
                  key={`${r.lat}-${r.lng}-${i}`}
                  type="button"
                  onClick={() => pick(r)}
                  className="flex w-full items-center gap-2.5 border-b border-ink-50 px-4 py-2.5 text-left last:border-0 hover:bg-ink-50"
                >
                  <MapPin size={15} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">{r.name}</span>
                    <span className="block truncate text-xs text-ink-500">{r.address}</span>
                  </span>
                  {r.km != null && (
                    <span className="shrink-0 text-xs text-ink-400">
                      {r.km < 1 ? `${Math.round(r.km * 1000)} m` : `${r.km.toFixed(1)} km`}
                    </span>
                  )}
                </button>
              ))
            )
          ) : (
            <NearbyPanel nearby={nearby} allowCurrentLocation={allowCurrentLocation} onPick={pick} onUseMyLocation={useMyLocation} />
          )}
        </div>
      )}

      {/* Refine: drag-on-map, plus exact points around the chosen place. */}
      {!open && selected && (onOpenMap || (refineNearby && around.length > 0)) && (
        <div className="mt-2">
          {onOpenMap && (
            <button
              type="button"
              onClick={onOpenMap}
              className="mb-2 flex w-full items-center gap-2 rounded-xl border border-ink-200 px-3 py-2.5 text-left text-sm transition-colors hover:border-accent/50"
            >
              <Map size={16} className="shrink-0 text-accent" />
              <span className="flex-1 font-medium text-ink-800">{t('adjustOnMap')}</span>
              <span className="text-xs text-ink-400">{t('dragThePin')}</span>
            </button>
          )}
          {refineNearby && around.length > 0 && (
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-400">
            <MapPin size={11} /> {t('orNearbyLandmark')}
          </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {(refineNearby ? around.slice(0, 6) : []).map((p) => (
              <button
                key={`${p.lat}-${p.lng}`}
                type="button"
                onClick={() => pick(p)}
                className="rounded-full border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-accent/50 hover:text-accent"
                title={p.address}
              >
                {p.name}
                <span className="ml-1 text-ink-400">{p.km < 1 ? `${Math.round(p.km * 1000)}m` : `${p.km.toFixed(1)}km`}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NearbyPanel({ nearby, allowCurrentLocation, onPick, onUseMyLocation }) {
  const t = useTranslations('Location');
  const { state, places, load } = nearby;

  if (state === 'loading') {
    return <div className="flex items-center gap-2 px-4 py-3 text-sm text-ink-400"><Loader2 size={15} className="animate-spin" /> {t('findingNearby')}</div>;
  }

  if (state === 'denied' || (state === 'ready' && places.length === 0)) {
    return <div className="flex items-center gap-2 px-4 py-3 text-sm text-ink-400"><Search size={15} /> {t('typeMore')}</div>;
  }

  if (state === 'idle') {
    return (
      <button type="button" onClick={load} className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-ink-50">
        <Navigation2 size={15} className="shrink-0 text-accent" />
        <span className="text-sm text-ink-700">{t('useMyLocation')}</span>
      </button>
    );
  }

  return (
    <>
      <p className="border-b border-ink-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-400">{t('nearbyYou')}</p>
      {allowCurrentLocation && (
        <button type="button" onClick={onUseMyLocation} className="flex w-full items-center gap-2.5 border-b border-ink-50 px-4 py-2.5 text-left hover:bg-ink-50">
          <Navigation2 size={15} className="shrink-0 text-accent" />
          <span className="text-sm font-medium text-ink-700">{t('myCurrentLocation')}</span>
        </button>
      )}
      {places.map((p) => (
        <button
          key={`${p.lat}-${p.lng}`}
          type="button"
          onClick={() => onPick(p)}
          className="flex w-full items-start gap-2.5 border-b border-ink-50 px-4 py-2.5 text-left last:border-0 hover:bg-ink-50"
        >
          <MapPin size={15} className="mt-0.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-sm text-ink-700">{p.address}</span>
          <span className="shrink-0 text-xs text-ink-400">{p.km < 1 ? `${Math.round(p.km * 1000)} m` : `${p.km.toFixed(1)} km`}</span>
        </button>
      ))}
    </>
  );
}
