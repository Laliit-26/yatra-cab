import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Card, Badge, StatusBadge, Segmented, QueryBoundary, EmptyState,
  inr, formatDateTime, vehicleLabel, RIDE_STATUS_META,
  useTranslations,
} from '@yatracab/ui';
import { ScrollText, MapPin, ChevronRight, Car } from 'lucide-react';
import { api } from '../api.js';

const ACTIVE = ['pending_payment', 'searching', 'confirmed', 'ongoing'];

// Left-border accent colour by ride status — gives instant visual scanning.
const STATUS_STRIPE = {
  ongoing: 'border-l-accent',
  confirmed: 'border-l-success',
  searching: 'border-l-info',
  pending_payment: 'border-l-warning',
  completed: 'border-l-ink-300',
  cancelled: 'border-l-danger',
  no_show: 'border-l-danger',
};

export default function MyRides() {
  const t = useTranslations('MyRides');
  const [filter, setFilter] = useState('all');

  const FILTERS = [
    { value: 'all', label: t('filterAll') },
    { value: 'active', label: t('filterActive') },
    { value: 'completed', label: t('filterCompleted') },
  ];

  const query = useQuery({ queryKey: ['my-rides'], queryFn: () => api.get('/customer/rides?limit=50').then((r) => r.rides) });

  const filtered = (rides) =>
    rides.filter((r) => (filter === 'all' ? true : filter === 'active' ? ACTIVE.includes(r.status) : r.status === 'completed'));

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">{t('title')}</h1>
          <p className="text-sm text-ink-500">{t('subtitle')}</p>
        </div>
        <Segmented value={filter} onChange={setFilter} options={FILTERS} />
      </div>

      <QueryBoundary
        query={query}
        loading={<RidesSkeleton />}
        isEmpty={(d) => !filtered(d).length}
        empty={
          <EmptyState
            icon={ScrollText}
            title={t('empty')}
            message={t('emptyText')}
          />
        }
      >
        {(rides) => (
          <div className="space-y-3">
            {filtered(rides).map((r) => (
              <RideCard key={r._id} ride={r} />
            ))}
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

function RideCard({ ride: r }) {
  const stripe = STATUS_STRIPE[r.status] || 'border-l-ink-200';
  return (
    <Link to={`/rides/${r._id}`}>
      <Card hover className={`overflow-hidden border-l-4 p-0 ${stripe} transition-all hover:-translate-y-0.5`}>
        <div className="flex items-center gap-4 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <MapPin size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-semibold text-ink-900">{r.destination || r.route?.destination}</p>
              <StatusBadge meta={RIDE_STATUS_META[r.status]} />
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1"><Car size={12} /> {vehicleLabel(r.vehicleType)}</span>
              <span>·</span>
              <span>{formatDateTime(r.scheduledAt)}</span>
              <span>·</span>
              <Badge tone={r.mode === 'bidding' ? 'info' : 'accent'}>{r.mode === 'bidding' ? 'Bidding' : 'Fixed'}</Badge>
            </p>
          </div>
          <div className="shrink-0 text-right">
            {r.totalAmount > 0 && <p className="font-semibold text-ink-900">{inr(r.totalAmount)}</p>}
            <ChevronRight size={16} className="ml-auto mt-1 text-ink-300" />
          </div>
        </div>
      </Card>
    </Link>
  );
}

// Content-shaped skeleton matching the RideCard layout.
function RidesSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((n) => (
        <div key={n} className="overflow-hidden rounded-2xl border border-ink-200/70 border-l-4 border-l-ink-200 bg-white p-4 shadow-card">
          <div className="flex items-center gap-4">
            <div className="yc-skeleton h-11 w-11 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className="yc-skeleton h-4 w-32 rounded" />
                <div className="yc-skeleton h-5 w-16 rounded-full" />
              </div>
              <div className="yc-skeleton h-3 w-48 rounded" />
            </div>
            <div className="yc-skeleton h-5 w-12 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
