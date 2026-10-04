import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Card, CardBody, Button, Badge, Modal, Field, Input, Avatar, StarRating, Segmented,
  QueryBoundary, EmptyState, toast, inr, vehicleLabel, LocationInput, VehicleIcon,
  useTranslations,
} from '@yatracab/ui';
import {
  Compass, Navigation, MapPin, ArrowRight, Clock, ShieldCheck, Users2, Minus, Plus, Loader2, Search, X,
} from 'lucide-react';
import { api } from '../api.js';
import { PHOTOS } from '../lib/photos.js';

const TYPE_OPTS = [
  { value: 'all', key: 'all' },
  { value: 'seat_share', key: 'shareSeats' },
  { value: 'full_cab', key: 'fullCab' },
];

// Addresses come back as "Sindhi Camp, Station Road, Jaipur" — the city is the
// part that actually matches a driver's published route, so search on that.
// 135 → "2h 15m", 40 → "40m"
const humanMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`);

const cityOf = (address = '') => {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] || address;
};

const defaultWhen = () => {
  const d = new Date(Date.now() + 12 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 16);
};

export default function Sharing() {
  const t = useTranslations('Sharing');
  const navigate = useNavigate();
  // Pickup is the rider's own location — fetched, never typed. They only say
  // where they want to go.
  // Pickup is editable — a rider may want a seat from somewhere other than
  // where they're standing — but GPS seeds it so most never touch it.
  const [fromPlace, setFromPlace] = useState(null);
  const [toPlace, setToPlace] = useState(null);
  const [gpsSeeded, setGpsSeeded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [type, setType] = useState('all');
  const [womenOnly, setWomenOnly] = useState(false);
  const [booking, setBooking] = useState(null); // route being booked

  const query = useQuery({
    queryKey: ['daily-routes', fromPlace?.lat, fromPlace?.lng, toPlace?.lat, toPlace?.lng, type, womenOnly],
    queryFn: () => {
      const params = new URLSearchParams();
      // Both ends are sent as coordinates so the server can rank by how close
      // each route runs to them, not just by a text match.
      if (fromPlace?.lat != null) { params.set('lat', fromPlace.lat); params.set('lng', fromPlace.lng); }
      if (toPlace?.lat != null) { params.set('toLat', toPlace.lat); params.set('toLng', toPlace.lng); }
      if (toPlace?.address) params.set('to', cityOf(toPlace.address));
      if (type !== 'all') params.set('type', type);
      if (womenOnly) params.set('womenOnly', 'true');
      const qs = params.toString();
      return api.get(`/customer/daily-routes${qs ? `?${qs}` : ''}`).then((r) => r.routes);
    },
  });

  const clearSearch = () => setToPlace(null);
  const searching = Boolean(toPlace);
  const loc = fromPlace;

  // Resolve coordinates to something a rider recognises ("Bais Godam, Jaipur").
  // GPS seeds the pickup field with a readable address, so the rider sees where
  // we think they are and can overwrite it.
  const seedPickup = useCallback(async (lat, lng) => {
    let address = '';
    try {
      const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1&lang=en`, {
        headers: { Accept: 'application/json' },
      });
      const p = (await res.json()).features?.[0]?.properties;
      const tidy = (v = '') =>
        v.replace(/\s+(Municipal Corporation|Municipality|Nagar Nigam|Tehsil|District|Division)$/i, '').trim();
      address = [p?.name || p?.district, tidy(p?.city || p?.county || '')].filter(Boolean).join(', ');
    } catch {
      /* label is cosmetic — the coordinates still drive the search */
    }
    setFromPlace({ address: address || t('usingMyLocation'), lat, lng });
  }, [t]);

  const locate = useCallback(
    ({ silent = false } = {}) => {
      if (!navigator.geolocation) return !silent && toast.error(t('notSupported'));
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          seedPickup(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
          setLocating(false);
          if (!silent) toast.error(t('permissionDenied'));
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
      return undefined;
    },
    [t, seedPickup]
  );

  // Seed once on arrival; after that the field is the rider's to edit.
  useEffect(() => {
    if (gpsSeeded) return;
    setGpsSeeded(true);
    locate({ silent: true });
  }, [gpsSeeded, locate]);


  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">{t('title')}</h1>
          <p className="text-sm text-ink-500">{t('subtitle')}</p>
        </div>
      </div>

      {/* Both ends: a shared ride is the driver's own route, so we match on
          where it starts and where it ends, at city level. */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
              <Search size={15} /> {t('whereTo')}
            </p>
            {searching && (
              <button type="button" onClick={clearSearch} className="flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900">
                <X size={13} /> {t('clear')}
              </button>
            )}
          </div>

          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-400">{t('pickupLabel')}</p>
            <LocationInput
              value={fromPlace}
              onChange={setFromPlace}
              placeholder={t('pickupPlaceholder')}
              allowCurrentLocation
              icon={Navigation}
              onError={toast.error}
            />
          </div>

          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-400">{t('dropLabel')}</p>
            <LocationInput
              value={toPlace}
              onChange={setToPlace}
              placeholder={t('dropPlaceholder')}
              icon={MapPin}
              onError={toast.error}
            />
          </div>

          {locating ? (
            <p className="flex items-center gap-1.5 text-xs text-ink-400">
              <Loader2 size={12} className="animate-spin" /> {t('detectingLocation')}
            </p>
          ) : (
            <p className="text-xs text-ink-400">{t('matchHint')}</p>
          )}
        </CardBody>
      </Card>

      {/* Filters */}
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <Segmented value={type} onChange={setType} options={TYPE_OPTS.map((o) => ({ value: o.value, label: t(o.key) }))} />
          <button
            type="button"
            onClick={() => setWomenOnly((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all ${
              womenOnly ? 'border-accent bg-accent-soft text-accent' : 'border-ink-200 text-ink-600 hover:border-accent/40'
            }`}
          >
            <img src={PHOTOS.womenOnly} alt="Two women travelling together" className="h-6 w-6 rounded-full border-2 border-white object-cover shadow-sm" />
            <ShieldCheck size={15} /> {t('womenOnly')}
          </button>
        </CardBody>
      </Card>

      <QueryBoundary
        query={query}
        isEmpty={(d) => !d.length}
        empty={
          <EmptyState
            icon={Compass}
            title={searching ? t('emptySearchTitle') : t('emptyTitle')}
            message={
              searching
                ? t('emptySearchText')
                : t('emptyText')
            }
          />
        }
      >
        {(routes) => (
          <div className="space-y-3">
            {routes.map((r) => (
              <RouteCard key={r._id} route={r} onBook={() => setBooking(r)} />
            ))}
          </div>
        )}
      </QueryBoundary>

      {booking && (
        <BookModal route={booking} onClose={() => setBooking(null)} onBooked={(ride) => navigate(`/rides/${ride._id}`)} />
      )}
    </div>
  );
}

function RouteCard({ route, onBook }) {
  const t = useTranslations('Sharing');
  const isShare = route.bookingType === 'seat_share';
  const price = isShare ? route.perSeatFare : route.fullCabFare;
  const driver = route.driver || {};
  const dUser = driver.user || {};
  return (
    <Card hover>
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={dUser.name || 'Driver'} size={44} />
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-ink-900">{dUser.name || 'Driver'}</p>
                {route.womenOnly && <Badge tone="accent"><ShieldCheck size={11} /> Women only</Badge>}
              </div>
              <p className="flex items-center gap-2 text-xs text-ink-500">
                <StarRating value={driver.rating || 5} size={11} />
                <span className="inline-flex items-center gap-1">
                  · <VehicleIcon type={route.vehicleType} size={13} /> {vehicleLabel(route.vehicleType)}
                </span>
                {driver.completedRides != null && <span>· {driver.completedRides} rides</span>}
              </p>
              {route.distanceFromYouKm != null && (
                <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-ink-600">
                  <Navigation size={11} /> {t('kmFromPickup', { km: route.distanceFromYouKm })}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-ink-900">{inr(price)}</p>
            <p className="text-xs text-ink-400">{isShare ? 'per seat' : 'full cab'}</p>
          </div>
        </div>

        {/* Origin → destination */}
        <div className="flex items-center gap-2 rounded-xl bg-ink-50 p-3 text-sm">
          <MapPin size={15} className="shrink-0 text-accent" />
          <span className="truncate font-medium text-ink-800">{route.origin?.address}</span>
          <ArrowRight size={14} className="shrink-0 text-ink-400" />
          <span className="truncate font-medium text-ink-800">{route.destination?.address}</span>
        </div>

        {/* Departure is the thing riders scan for, so it gets its own row. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-2.5 py-1.5 text-sm font-bold text-white">
            <Clock size={14} /> {route.departureTime || '—'}
          </span>
          {route.departsInMins != null && route.departsInMins < 24 * 60 && (
            <span className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-semibold text-accent">
              {route.departsInMins <= 1 ? t('departsNow') : t('departsIn', { time: humanMins(route.departsInMins) })}
            </span>
          )}
          {route.distanceToDropKm != null && (
            <span className="rounded-lg bg-ink-100 px-2.5 py-1.5 text-xs font-medium text-ink-600">
              {t('toYourDrop', { km: route.distanceToDropKm })}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-500">
          {route.distanceKm > 0 && <span>{route.distanceKm} km</span>}
          {isShare && <span>· {route.seatsTotal} seats</span>}
          <span className="inline-flex flex-wrap gap-1">
            {(route.days || []).map((d) => (
              <span key={d} className="rounded-full bg-ink-100 px-2 py-0.5 font-medium capitalize text-ink-600">{d}</span>
            ))}
          </span>
        </div>

        <Button className="w-full" icon={Users2} onClick={onBook}>Book {isShare ? 'a seat' : 'this cab'}</Button>
      </CardBody>
    </Card>
  );
}

function BookModal({ route, onClose, onBooked }) {
  const isShare = route.bookingType === 'seat_share';
  const [seats, setSeats] = useState(1);
  const [scheduledAt, setScheduledAt] = useState(defaultWhen());

  const book = useMutation({
    mutationFn: () =>
      api.post(`/customer/daily-routes/${route._id}/book`, {
        seats: isShare ? Number(seats) : 1,
        scheduledAt: new Date(scheduledAt).toISOString(),
      }),
    onSuccess: (res) => {
      toast.success('Booked! Redirecting to your ride…');
      onBooked(res.ride);
    },
    onError: (err) => toast.error(err.message),
  });

  const fare = isShare ? route.perSeatFare * seats : route.fullCabFare;

  return (
    <Modal open onClose={book.isPending ? undefined : onClose} title="Book this route" subtitle={`${route.origin?.address} → ${route.destination?.address}`} size="sm">
      <div className="space-y-4">
        {isShare && (
          <div className="flex items-center justify-between rounded-xl bg-ink-50 p-3.5">
            <span className="text-sm font-medium text-ink-700">Seats</span>
            <div className="flex items-center gap-3">
              <button type="button" disabled={seats <= 1} onClick={() => setSeats((s) => Math.max(1, s - 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 text-ink-600 disabled:opacity-40"><Minus size={15} /></button>
              <span className="w-5 text-center text-base font-semibold text-ink-900">{seats}</span>
              <button type="button" disabled={seats >= route.seatsTotal} onClick={() => setSeats((s) => Math.min(route.seatsTotal, s + 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 text-ink-600 disabled:opacity-40"><Plus size={15} /></button>
            </div>
          </div>
        )}
        <Field label="When">
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>
        <div className="flex items-center justify-between rounded-xl bg-accent-soft px-4 py-3">
          <span className="text-sm text-accent">{isShare ? `${seats} seat${seats > 1 ? 's' : ''}` : 'Full cab'}</span>
          <span className="text-lg font-semibold text-accent">{inr(fare)}</span>
        </div>
        <Button className="w-full" size="lg" loading={book.isPending} onClick={() => book.mutate()}>Confirm booking</Button>
      </div>
    </Modal>
  );
}
