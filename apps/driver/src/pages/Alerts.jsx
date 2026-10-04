import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, CardBody, Button, Badge, Modal, Field, Input, Textarea, PageHeader,
  QueryBoundary, LoadingScreen, EmptyState, toast, inr, formatDateTime, timeUntil, vehicleLabel,
  useTranslations,
} from '@yatracab/ui';
import { Gavel, MapPin, Users, CalendarClock, TrendingDown, Info, CarFront } from 'lucide-react';
import { api } from '../api.js';

export default function Alerts() {
  const t = useTranslations('Driver');
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const query = useQuery({
    queryKey: ['driver-alerts'],
    queryFn: () => api.get('/driver/alerts'),
    refetchInterval: 8000,
  });

  const bid = useMutation({
    mutationFn: () => api.post(`/driver/rides/${selected._id}/bid`, { amount: Number(amount), note: note || undefined }),
    onSuccess: () => {
      toast.success(t('quoteSubmitted'));
      setSelected(null); setAmount(''); setNote('');
      qc.invalidateQueries({ queryKey: ['driver-alerts'] });
      qc.invalidateQueries({ queryKey: ['driver-bids'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const openBid = (alert) => {
    setSelected(alert);
    setAmount(String(alert.route?.floorPrice || ''));
    setNote('');
  };

  const submit = () => {
    const floor = selected.route?.floorPrice || 0;
    if (!amount || Number(amount) < floor) return toast.error(`Bid must be at least ${inr(floor)}`);
    bid.mutate();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader icon={Gavel} title={t('alertsTitle')} subtitle={t('alertsSubtitle')} />

      <QueryBoundary
        query={query}
        loading={<LoadingScreen label="Finding open alerts…" />}
        isEmpty={(d) => !d?.blocked && !d?.alerts?.length}
        empty={<EmptyState icon={Gavel} title={t('noAlerts')} message={t('noAlertsText')} />}
      >
        {(data) => (data.blocked ? (
          <Card>
            <CardBody className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <CarFront size={20} />
              </span>
              <div>
                <p className="font-semibold text-ink-900">{t('onTrip')}</p>
                <p className="mt-0.5 text-sm text-ink-500">
                  {t('onTripText', { dest: data.activeRide?.drop?.address ? ` to ${data.activeRide.drop.address}` : '' })}
                </p>
              </div>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-3">
            {data.alerts.map((a) => (
              <Card key={a._id}>
                <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ink-900">{a.destination || a.route?.destination}</p>
                      {a.biddingClosesAt && <Badge tone="info" dot>{timeUntil(a.biddingClosesAt)}</Badge>}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                      <span className="inline-flex items-center gap-1"><MapPin size={12} /> {a.pickup?.address || `from ${a.route?.origin || 'Jaipur'}`}</span>
                      <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> {formatDateTime(a.scheduledAt)}</span>
                      <span className="inline-flex items-center gap-1"><Users size={12} /> {a.passengers} pax</span>
                      <span>{vehicleLabel(a.vehicleType)}</span>
                      {a.distanceKm > 0 && <span>· {a.distanceKm} km</span>}
                    </p>
                    {a.route?.fairRange && (
                      <p className="mt-1 text-xs text-ink-400">Fair range {inr(a.route.fairRange.min)}–{inr(a.route.fairRange.max)} · Floor {inr(a.route.floorPrice)}</p>
                    )}
                    {a.notes && <p className="mt-1 flex items-start gap-1 text-xs text-ink-500"><Info size={12} className="mt-0.5" /> {a.notes}</p>}
                  </div>
                  <Button icon={Gavel} onClick={() => openBid(a)}>Place bid</Button>
                </CardBody>
              </Card>
            ))}
          </div>
        ))}
      </QueryBoundary>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={t('placeQuote')}
        subtitle={selected ? `${selected.destination || selected.route?.destination} · ${vehicleLabel(selected.vehicleType)}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>{t('cancel')}</Button>
            <Button loading={bid.isPending} onClick={submit}>{t('submitQuote')}</Button>
          </>
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-xl bg-accent-soft p-3 text-sm text-accent">
              <TrendingDown size={16} />
              {t('floorPrice')} <span className="font-semibold">{inr(selected.route?.floorPrice || 0)}</span>
            </div>
            <Field label={t('yourPrice')} hint={t('yourPriceHint')}>
              <Input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 3200" autoFocus />
            </Field>
            <Field label={t('noteToCustomer')} hint={t('optional')}>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} />
            </Field>
            <p className="text-xs text-ink-400">{t('feeNote')}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
