import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Card, CardBody, Button, Field, Input, Textarea, Select, LocationInput,
  EmptyState, toast,
  useTranslations,
} from '@yatracab/ui';
import {
  MapPin, Navigation, Gavel, Info, Route as RouteIcon, ArrowDown, Clock,
  Train, ChevronDown,
} from 'lucide-react';
import { api } from '../api.js';
import { MapPicker } from '../components/MapPicker.jsx';

const defaultWhen = () => {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 16);
};

export default function Book() {
  const t = useTranslations('Book');
  const tMap = useTranslations('MapPicker');
  const navigate = useNavigate();
  // Deep-link presets from the home tiles and destination chips.
  const [params] = useSearchParams();
  const [pickup, setPickup] = useState(null); // { address, lat, lng }
  // A destination chip from Home arrives as name + coordinates, so the form is
  // ready to request quotes the moment a pickup is set.
  const [drop, setDrop] = useState(() => {
    const address = params.get('drop');
    const lat = Number(params.get('dlat'));
    const lng = Number(params.get('dlng'));
    return address && Number.isFinite(lat) && Number.isFinite(lng) ? { address, lat, lng } : null;
  });
  // Most riders take a single trip, so one-way is the default.
  const [tripType, setTripType] = useState(params.get('trip') === 'round_trip' ? 'round_trip' : 'one_way');
  const [scheduledAt, setScheduledAt] = useState(defaultWhen());
  const [passengers, setPassengers] = useState(2);
  const [notes, setNotes] = useState('');
  const [biddingWindowMins, setBiddingWindowMins] = useState(30);
  const [transportOpen, setTransportOpen] = useState(false);
  const [transportType, setTransportType] = useState('none');
  const [transportNumber, setTransportNumber] = useState('');
  const [transportAt, setTransportAt] = useState('');
  const [mapFor, setMapFor] = useState(null); // 'pickup' | 'drop'


  const hasTrip = pickup?.lat != null && drop?.lat != null;

  const quoteQuery = useQuery({
    queryKey: ['quote', pickup?.lat, pickup?.lng, drop?.lat, drop?.lng, drop?.address, tripType],
    enabled: hasTrip,
    queryFn: () =>
      api
        .post('/customer/rides/quote', { pickup, drop, tripType })
        .then((r) => r.quote),
  });
  const quote = quoteQuery.data;

  const onDropChange = (loc) => setDrop(loc);

  const book = useMutation({
    mutationFn: () => {
      const base = {
        // A Ride Alert carries no vehicle preference — drivers bid with theirs.
        tripType,
        scheduledAt: new Date(scheduledAt).toISOString(),
        passengers: Number(passengers),
        pickup,
        notes: notes.trim() || undefined,
      };
      // Transport is additive. It used to be an either/or with the drop, so
      // declaring a train silently posted a ride with no destination and the
      // server rejected it — telling the rider to choose a drop they could see
      // filled in on screen.
      base.drop = drop;
      if (transportType !== 'none') {
        base.transport = {
          type: transportType,
          number: transportNumber.trim() || undefined,
          scheduledAt: transportAt ? new Date(transportAt).toISOString() : undefined,
        };
      }
      return api.post('/customer/rides/alert', { ...base, biddingWindowMins: Number(biddingWindowMins) });
    },
    onSuccess: (res) => {
      toast.success(t('posted'));
      navigate(`/rides/${res.ride._id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!pickup?.address) return toast.error('Set your pickup location');
    if (pickup?.lat == null) return toast.error(t('needPickup'));
    if (drop?.lat == null) return toast.error(t('needDrop'));
    book.mutate();
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">{t('title')}</h1>
          <p className="text-sm text-ink-500">{t('subtitle')}</p>
        </div>

      </div>

      {/* Pickup + drop */}
      <Card>
        <CardBody className="space-y-3">
          <div className="relative">
            <div className="space-y-2.5">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">{t('pickup')}</p>
                <LocationInput
                  value={pickup}
                  onChange={setPickup}
                  placeholder={t('pickupPlaceholder')}
                  allowCurrentLocation
                  icon={Navigation}
                  onOpenMap={() => setMapFor('pickup')}
                  onError={toast.error}
                />
              </div>
              <div className="flex justify-center">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-100 text-ink-400"><ArrowDown size={14} /></span>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">{t('drop')}</p>
                <LocationInput
                  value={drop}
                  onChange={onDropChange}
                  placeholder={t('dropPlaceholder')}
                  icon={MapPin}
                  refineNearby
                  onOpenMap={() => setMapFor('drop')}
                  onError={toast.error}
                />
              </div>
            </div>
          </div>

        </CardBody>
      </Card>

      {/* Trip details (once a trip is set) */}
      {hasTrip && (
        <Card className="animate-fade-in">
          <CardBody className="space-y-4">
            {/* Distance / ETA */}
            <div className="flex items-center gap-4 rounded-xl bg-accent-soft px-4 py-3 text-sm">
              {quoteQuery.isLoading ? (
                <span className="text-accent">Calculating route…</span>
              ) : quote ? (
                <>
                  <span className="flex items-center gap-1.5 font-medium text-accent"><RouteIcon size={15} /> {quote.distanceKm} km</span>
                  <span className="flex items-center gap-1.5 text-ink-500"><Clock size={15} /> ~{Math.floor(quote.estimatedMins / 60)}h {quote.estimatedMins % 60}m</span>
                </>
              ) : null}
            </div>

            {/* No vehicle picker and no prices: the rider says where and when,
                every available driver quotes with their own cab, and the rider
                chooses on comfort and price from the bids. */}
            <div className="flex items-start gap-2.5 rounded-xl bg-accent-soft p-4 text-sm text-ink-700">
              <Gavel size={16} className="mt-0.5 shrink-0 text-accent" />
              <p>
                <span className="font-semibold text-ink-900">{t('quoteExplainerLead')}</span> {t('quoteExplainer').replace(t('quoteExplainerLead'), '').trim()}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('tripType')}>
                <Select value={tripType} onChange={(e) => setTripType(e.target.value)}>
                  <option value="round_trip">{t('roundTrip')}</option>
                  <option value="one_way">{t('oneWay')}</option>
                </Select>
              </Field>
              <Field label={t('when')}>
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </Field>
              <Field label={t('passengers')}>
                <Input type="number" min={1} max={12} value={passengers} onChange={(e) => setPassengers(e.target.value)} />
              </Field>
              {(
                <Field label={t('quoteWindow')} hint={t('quoteWindowHint')}>
                  <Select value={biddingWindowMins} onChange={(e) => setBiddingWindowMins(e.target.value)}>
                    <option value={15}>{t('minutes15')}</option>
                    <option value={30}>{t('minutes30')}</option>
                    <option value={60}>{t('hours1')}</option>
                    <option value={180}>{t('hours3')}</option>
                    <option value={360}>{t('hours6')}</option>
                    <option value={720}>{t('hours12')}</option>
                  </Select>
                </Field>
              )}
            </div>

            <Field label={t('notes')} hint={t('optional')}>
              <Textarea placeholder={t('notesPlaceholder')} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            {/* {t('transportTitle')} (collapsible) */}
            <div className="rounded-xl border border-ink-200">
              <button
                type="button"
                onClick={() => setTransportOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink-700"
              >
                <span className="flex items-center gap-1.5"><Train size={15} className="text-accent" /> Arriving by train/flight?</span>
                <ChevronDown size={16} className={`text-ink-400 transition-transform ${transportOpen ? 'rotate-180' : ''}`} />
              </button>
              {transportOpen && (
                <div className="space-y-3 border-t border-ink-100 p-4 animate-fade-in">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Mode">
                      <Select value={transportType} onChange={(e) => setTransportType(e.target.value)}>
                        <option value="none">None</option>
                        <option value="train">Train</option>
                        <option value="flight">Flight</option>
                        <option value="bus">Bus</option>
                      </Select>
                    </Field>
                    <Field label="Number" hint="train / flight no.">
                      <Input value={transportNumber} onChange={(e) => setTransportNumber(e.target.value)} placeholder="e.g. 12956 / AI-501" disabled={transportType === 'none'} />
                    </Field>
                  </div>
                  <Field label="Scheduled arrival">
                    <Input type="datetime-local" value={transportAt} onChange={(e) => setTransportAt(e.target.value)} disabled={transportType === 'none'} />
                  </Field>
                  <p className="flex items-start gap-1.5 text-xs text-ink-500">
                    <Info size={13} className="mt-0.5 shrink-0" />
                    We'll auto-adjust your pickup time if your train/flight is delayed.
                  </p>
                </div>
              )}
            </div>

            {/* Deliberately no fare here — price comes from the drivers' quotes. */}
            <div className="rounded-xl bg-ink-50 p-4 text-sm text-ink-600">
              <p className="flex items-center gap-1.5 font-medium text-ink-900"><Info size={15} /> {t('whatNext')}</p>
              <ol className="mt-2 space-y-1 pl-4 text-ink-600 [&>li]:list-decimal">
                <li>{t('step1')}</li>
                <li>{t('step2')}</li>
                <li>{t('step3')}</li>
              </ol>
              <p className="mt-2 text-xs text-ink-500">{t('nothingCharged')}</p>
            </div>

            <Button className="w-full" size="lg" loading={book.isPending} icon={Gavel} onClick={submit}>
              {t('submit')}
            </Button>
          </CardBody>
        </Card>
      )}

      <MapPicker
        open={mapFor !== null}
        value={mapFor === 'pickup' ? pickup : drop}
        title={mapFor === 'pickup' ? tMap('adjustPickup') : tMap('adjustDrop')}
        
        onClose={() => setMapFor(null)}
        onConfirm={(loc) => (mapFor === 'pickup' ? setPickup(loc) : onDropChange(loc))}
      />

      {!hasTrip && (
        <EmptyState icon={MapPin} title={t('emptyTitle')} message={t('emptyText')} />
      )}
    </div>
  );
}
