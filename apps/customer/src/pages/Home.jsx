import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth, Badge, toast, useTranslations } from '@yatracab/ui';
import {
  MapPin, Navigation, ArrowRight, Repeat, Users2, IndianRupee, Gift, Sparkles, ChevronRight, Car, Route as RouteIcon,
} from 'lucide-react';
import { api } from '../api.js';
import { LiveMap } from '../components/LiveMap.jsx';
import { OneWayRoad, RoundTripRoad } from '../components/RoadIllustration.jsx';
import { SeatShareArt } from '../components/SeatShareArt.jsx';
import { PHOTOS } from '../lib/photos.js';

// Reverse-geocode via OpenStreetMap (same provider as LocationInput).
async function reverseGeocode(lat, lng) {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('lookup failed');
  const data = await res.json();
  return data.display_name?.split(',').slice(0, 3).map((s) => s.trim()).join(', ');
}

// The API computes this per departure day; fall back for older payloads.
const availableSeats = (r) => r?.seatsLeft ?? Math.max(0, (r?.seatsTotal ?? 0) - (r?.seatsBooked ?? 0));

// Popular temple/outstation destinations in Rajasthan.
// Names are proper nouns — no translation needed. Coordinates travel with the
// name because Book needs a drop with lat/lng before it will request quotes;
// sending the name alone would land the rider on an empty form.
const DESTINATIONS = [
  { name: 'Pushkar', emoji: '🕉️', lat: 26.4899, lng: 74.5511 },
  { name: 'Ajmer', emoji: '🌹', lat: 26.4499, lng: 74.6399 },
  { name: 'Amber Fort', emoji: '🏰', lat: 26.9855, lng: 75.8513 },
  { name: 'Chittorgarh', emoji: '⚔️', lat: 24.8887, lng: 74.6269 },
  { name: 'Ranakpur', emoji: '🪨', lat: 25.1152, lng: 73.4875 },
  { name: 'Nathdwara', emoji: '🪔', lat: 24.933, lng: 73.82 },
  { name: 'Eklingji', emoji: '🙏', lat: 24.715, lng: 73.742 },
  { name: 'Bundi', emoji: '🏯', lat: 25.4305, lng: 75.6499 },
  { name: 'Ranthambore', emoji: '🐅', lat: 26.0173, lng: 76.5026 },
];

export default function Home() {
  const t = useTranslations('Home');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [position, setPosition] = useState(null);
  const [address, setAddress] = useState('');

  // Ambient "cars near me". Polled, not pushed: a rider does not need every
  // driver's every move, and fanning the fleet to every open app is a lot of
  // traffic for a decorative layer. The ride they book is pushed over a socket.
  const nearbyQ = useQuery({
    queryKey: ['nearby-drivers', position?.lat?.toFixed(3), position?.lng?.toFixed(3)],
    queryFn: () =>
      api.get(`/customer/drivers/nearby?lat=${position.lat}&lng=${position.lng}`).then((r) => r.drivers),
    enabled: position?.lat != null,
    refetchInterval: 15000,
  });

  // Live data for the tiles.
  const routesQ = useQuery({ queryKey: ['routes'], queryFn: () => api.get('/shared/routes').then((r) => r.routes) });
  const sharesQ = useQuery({ queryKey: ['daily-routes-home'], queryFn: () => api.get('/customer/daily-routes').then((r) => r.routes) });

  const onLocate = async (pos) => {
    setPosition(pos);
    try {
      setAddress(await reverseGeocode(pos.lat, pos.lng));
    } catch {
      setAddress('My current location');
    }
  };

  // Try GPS once on load (silently — the map button retries on demand).
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => onLocate({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shares = sharesQ.data?.filter((r) => r.bookingType === 'seat_share') ?? [];
  const bookable = shares.filter((r) => availableSeats(r) > 0);
  const seatRides = sharesQ.data ? bookable.length : null;

  return (
    <div className="-mx-4 -mt-5 animate-fade-in sm:mx-0 sm:mt-0">
      {/* Address bar */}
      <div className="flex items-center gap-2.5 bg-white px-4 py-3 sm:rounded-2xl sm:border sm:border-ink-200/70 sm:shadow-card">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <MapPin size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{t('yourLocation')}</p>
          <p className="truncate text-sm font-semibold text-ink-900">
            {address || (position ? t('locating') : t('enableLocation'))}
          </p>
        </div>
        <Link to="/book" className="flex items-center gap-1 rounded-full bg-brand-gradient px-3.5 py-2 text-xs font-semibold text-accent-fg shadow-glow transition-transform hover:scale-105">
          {t('bookCta')} <ArrowRight size={13} />
        </Link>
      </div>

      {/* Live map */}
      <LiveMap position={position} onLocate={onLocate} cars={nearbyQ.data || []} className="h-[38vh] min-h-[240px] w-full sm:mt-4 sm:h-[300px] sm:rounded-2xl sm:border sm:border-ink-200/70" />

      {/* Welcome ribbon */}
      <div className="mx-4 -mt-3 relative z-[600] flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-sm text-white shadow-pop sm:mx-0 sm:mt-4">
        <Sparkles size={15} className="shrink-0 text-amber-300" />
        <span className="truncate">{t('greeting', { name: user?.name ? `, ${user.name.split(' ')[0]}` : '' })}</span>
      </div>

      {/* Popular destination chips — horizontal scroll, tap to pre-fill Book */}
      <div className="pt-3">
        <p className="mb-2.5 px-4 text-[11px] font-semibold uppercase tracking-widest text-ink-400 sm:px-0">
          {t('popularDest')}
        </p>
        <div className="flex gap-2.5 overflow-x-auto px-4 pb-1 sm:px-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {DESTINATIONS.map((d) => (
            <button
              key={d.name}
              type="button"
              onClick={() => navigate(`/book?drop=${encodeURIComponent(d.name)}&dlat=${d.lat}&dlng=${d.lng}`)}
              className="group flex shrink-0 items-center gap-2 rounded-2xl border border-ink-200/80 bg-white px-3.5 py-2 shadow-card transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-soft active:scale-95"
            >
              <span className="text-base leading-none">{d.emoji}</span>
              <span className="text-sm font-medium text-ink-700 group-hover:text-ink-900">{d.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Service tiles */}
      <div className="space-y-3 px-4 pt-4 sm:px-0">
        <div className="grid grid-cols-2 gap-3">
          <ServiceTile
            to="/book?trip=one_way"
            icon={Navigation}
            title={t('oneWay')}
            text={t('oneWayText')}
            art={OneWayRoad}
          />
          <ServiceTile
            to="/book?trip=round_trip"
            icon={Repeat}
            title={t('roundTrip')}
            text={t('roundTripText')}
            art={RoundTripRoad}
            sub={routesQ.data ? t('popularRoutes', { count: routesQ.data.length }) : null}
          />
        </div>

        {/* Share a seat — deliberately location-agnostic: a specific route is
            only relevant to riders near it, so lead with the idea instead. */}
        <Link
          to="/sharing"
          className="group block overflow-hidden rounded-2xl border border-ink-200 bg-gradient-to-br from-accent-soft via-white to-white shadow-card transition-all hover:-translate-y-0.5 hover:shadow-soft"
        >
          <div className="flex items-center gap-5 p-5">
            <SeatShareArt className="h-24 w-auto shrink-0 text-accent sm:h-28" taken={1} total={4} />

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-1.5 font-display text-lg font-bold text-ink-900">
                  <Users2 size={17} className="text-accent" /> {t('shareSeat')}
                </p>
                {seatRides ? (
                  <span className="shrink-0 rounded-full bg-ink-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                    {t('todayCount', { count: seatRides })}
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-sm text-ink-500">{t('payOnlyYourSeat')}</p>

              <ul className="mt-2.5 space-y-1 text-xs text-ink-600">
                <li className="flex items-center gap-1.5">
                  <IndianRupee size={12} className="shrink-0 text-accent" /> {t('splitFare')}
                </li>
                <li className="flex items-center gap-1.5">
                  <Repeat size={12} className="shrink-0 text-accent" /> {t('dailyRoutesHint')}
                </li>
              </ul>

              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-900">
                {t('findSeat')} <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </div>
        </Link>

        {/* Refer & earn banner — chain referral mechanic */}
        <Link
          to="/rewards"
          className="relative block overflow-hidden rounded-2xl bg-brand-gradient p-5 text-accent-fg shadow-glow transition-transform hover:-translate-y-0.5"
        >
          <ChainIllustration className="pointer-events-none absolute -right-1 top-1/2 h-[92%] w-2/5 -translate-y-1/2 opacity-95" />
          <div className="relative flex items-center gap-4 pr-28 sm:pr-36">
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-bold">{t('referTitle')}</p>
              <p className="mt-0.5 text-sm text-white/85">
                {t('referText')}
              </p>
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-accent">
                {user?.points ? t('pts', { n: user.points }) : t('startChain')} <ChevronRight size={13} />
              </span>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}

// Chain-referral illustration: You → Friend → Friend's friend, with the
// reward % flowing back down the chain to your wallet.
function ChainIllustration({ className }) {
  return (
    <svg viewBox="0 0 150 120" fill="none" className={className} aria-label="Referral chain: friends of friends also earn you rewards">
      {/* chain links connecting the three people */}
      <path d="M34 34 L64 58 M78 62 L106 40" stroke="white" strokeOpacity="0.85" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 7" />
      {/* person 1 — you */}
      <g>
        <circle cx="24" cy="26" r="13" fill="white" fillOpacity="0.95" />
        <circle cx="24" cy="22" r="4.5" fill="rgb(124 58 237)" />
        <path d="M16 32c1.5-4 4.5-6 8-6s6.5 2 8 6" stroke="rgb(124 58 237)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      </g>
      {/* person 2 — your friend */}
      <g>
        <circle cx="71" cy="62" r="11" fill="white" fillOpacity="0.85" />
        <circle cx="71" cy="58.5" r="3.8" fill="rgb(124 58 237)" />
        <path d="M64.5 67c1.3-3.4 3.8-5 6.5-5s5.2 1.6 6.5 5" stroke="rgb(124 58 237)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      </g>
      {/* person 3 — friend's friend */}
      <g>
        <circle cx="116" cy="34" r="9.5" fill="white" fillOpacity="0.75" />
        <circle cx="116" cy="31" r="3.2" fill="rgb(124 58 237)" />
        <path d="M110.5 38.5c1.1-2.9 3.2-4.3 5.5-4.3s4.4 1.4 5.5 4.3" stroke="rgb(124 58 237)" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
      {/* % coins flowing back along the chain */}
      <g fontFamily="system-ui" fontWeight="700" textAnchor="middle">
        <circle cx="95" cy="55" r="8" fill="#fbbf24" />
        <text x="95" y="58.5" fontSize="9" fill="#78350f">%</text>
        <circle cx="49" cy="42" r="8" fill="#fbbf24" />
        <text x="49" y="45.5" fontSize="9" fill="#78350f">%</text>
      </g>
      {/* wallet receiving the rewards, under "you" */}
      <g>
        <rect x="10" y="78" width="42" height="28" rx="6" fill="white" fillOpacity="0.95" />
        <rect x="10" y="86" width="42" height="4" fill="rgb(124 58 237)" fillOpacity="0.25" />
        <circle cx="44" cy="92" r="5" fill="rgb(124 58 237)" />
        <text x="44" y="95" fontSize="7" fill="white" fontWeight="700" textAnchor="middle" fontFamily="system-ui">₹</text>
      </g>
      {/* arrow: rewards drop into the wallet */}
      <path d="M31 56 L31 70 M27 66 L31 71 L35 66" stroke="#fbbf24" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// Photo-backed square tile (RodBez style): image fills the card, dark
// gradient keeps the text readable.
function ServiceTile({ to, icon: Icon, title, text, photo, alt, sub, art: Art }) {
  const t = useTranslations('Home');
  // Illustrated tiles sit on a light surface so the black road reads; photo
  // tiles keep the dark scrim treatment.
  if (Art) {
    // Flex column, not an overlay: the road gets the space left over after the
    // caption, so the two can never collide at any tile size.
    return (
      <Link
        to={to}
        className="group flex h-52 flex-col overflow-hidden rounded-2xl border border-ink-200 bg-gradient-to-b from-accent-soft to-white shadow-card transition-all hover:-translate-y-0.5 hover:shadow-soft"
      >
        <div className="min-h-0 flex-1 px-3 pt-3">
          <Art className="h-full w-full transition-transform duration-500 group-hover:scale-105" />
        </div>
        <div className="shrink-0 px-4 pb-4 pt-2">
          <p className="flex items-center gap-1.5 font-display text-lg font-bold leading-tight text-ink-900">
            <Icon size={16} className="text-accent" /> {title}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">{text}</p>
          {sub && <p className="mt-0.5 text-[11px] font-medium text-ink-700">{sub}</p>}
          <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-ink-900">
            {t('bookNow')} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={to}
      className="group relative block h-48 overflow-hidden rounded-2xl bg-ink-900 text-white shadow-soft transition-transform hover:-translate-y-0.5"
    >
      <img src={photo} alt={alt} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/35 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <span className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur">
          <Icon size={16} />
        </span>
        <p className="font-display text-lg font-bold leading-tight">{title}</p>
        <p className="mt-0.5 text-xs text-white/80">{text}</p>
        {sub && <p className="mt-0.5 text-[11px] font-medium text-white/90">{sub}</p>}
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold">
          Book now <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

// Wide tile with the photo filling the right edge.
function WideTile({ to, icon: Icon, title, text, badge, cta, tone, photo, alt }) {
  const t = useTranslations('Home');
  const dark = tone === 'dark';
  return (
    <Link
      to={to}
      className={`group relative flex items-center gap-4 overflow-hidden rounded-2xl p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-soft ${
        dark ? 'bg-ink-900 text-white' : 'border border-ink-200/70 bg-white'
      }`}
    >
      {photo && (
        <img
          src={photo}
          alt={alt}
          loading="lazy"
          className="absolute inset-y-0 right-0 h-full w-1/3 object-cover [mask-image:linear-gradient(to_left,black_60%,transparent)] transition-transform duration-500 group-hover:scale-105"
        />
      )}
      <span className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${dark ? 'bg-white/10 text-white' : 'bg-accent-soft text-accent'}`}>
        <Icon size={23} />
      </span>
      <div className="relative min-w-0 flex-1 pr-16 sm:pr-24">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`font-display text-base font-bold ${dark ? 'text-white' : 'text-ink-900'}`}>{title}</p>
          {badge && <Badge tone={dark ? 'warning' : 'accent'}>{badge}</Badge>}
        </div>
        <p className={`mt-0.5 text-xs ${dark ? 'text-white/75' : 'text-ink-500'}`}>{text}</p>
        <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-bold ${dark ? 'bg-white text-ink-900' : 'bg-brand-gradient text-accent-fg shadow-glow'}`}>
          {cta} <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
