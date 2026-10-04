import { useQuery } from '@tanstack/react-query';
import {
  Card, CardHeader, CardBody, Button, Badge, Avatar,
  QueryBoundary, EmptyState, LoadingScreen, toast,
  useTranslations,
} from '@yatracab/ui';
import { Gift, Copy, Users, Sparkles, Share2, TrendingUp, Network, Receipt, Link2 } from 'lucide-react';
import { api } from '../api.js';
import { InviteContacts } from '../components/InviteContacts.jsx';

const LEVEL_TONE = { 0: 'accent', 1: 'success', 2: 'warning', 3: 'info' };

export default function Rewards() {
  const t = useTranslations('Rewards');
  const query = useQuery({ queryKey: ['referral'], queryFn: () => api.get('/customer/referral') });
  const earningsQuery = useQuery({
    queryKey: ['referral-earnings'],
    queryFn: () => api.get('/customer/referral/earnings').then((r) => r.earnings),
  });

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code)
      .then(() => toast.success(t('codeCopied')))
      .catch(() => toast.error('Could not copy — code is ' + code));
  };

  // A share link drops friends straight onto signup with the code prefilled.
  // The page carries OG tags, so WhatsApp previews it with the YatraCab mark.
  const inviteLink = (code) => `${window.location.origin}/?ref=${code}`;

  const copyLink = (code) => {
    const link = inviteLink(code);
    navigator.clipboard?.writeText(link)
      .then(() => toast.success(t('linkCopied')))
      .catch(() => toast.error('Could not copy — link is ' + link));
  };

  // Native share sheet where available (mobile); clipboard fallback elsewhere.
  const shareLink = async (code) => {
    const url = inviteLink(code);
    const payload = {
      title: 'YatraCab — Rides, your way',
      text: `Book temple & outstation cabs on YatraCab. Use my code ${code} and we both get 50 points.`,
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return; // user dismissed the sheet
      }
    }
    copyLink(code);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink-900">{t('title')}</h1>
        <p className="text-sm text-ink-500">{t('subtitle')}</p>
      </div>

      <QueryBoundary query={query} loading={<LoadingScreen label="Loading your rewards…" />}>
        {(data) => (
          <>
            {/* Points balance — mandala decoration + progress ring */}
            <Card className="overflow-hidden">
              <CardBody className="relative bg-brand-gradient text-accent-fg">
                <div className="absolute inset-0 bg-dotted opacity-20" />
                {/* Decorative mandala rings (top-right) */}
                <MandalaDecoration className="pointer-events-none absolute -right-4 -top-4 h-36 w-36 opacity-20" />
                <div className="relative flex items-start gap-4">
                  {/* Circular progress ring toward next ₹100 milestone */}
                  <PointsRing points={data.points} />
                  <div className="flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium opacity-90"><Sparkles size={15} /> {t('pointsBalance')}</p>
                    <p className="mt-0.5 font-display text-5xl font-bold leading-none">{data.points}</p>
                    <p className="mt-1 text-sm opacity-90">{t('pointWorth')}</p>
                  </div>
                </div>
                <div className="relative mt-4 flex gap-6 border-t border-white/25 pt-3 text-sm">
                  <div>
                    <p className="opacity-80">{t('fromYourRides')}</p>
                    <p className="text-lg font-semibold">{data.cashbackEarned}</p>
                  </div>
                  <div>
                    <p className="opacity-80">{t('fromYourNetwork')}</p>
                    <p className="text-lg font-semibold">{data.chainEarned}</p>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Network — total chain size, then each level broken out */}
            <Card>
              <CardHeader title={t('yourChain')} subtitle={t('chainSubtitle')} icon={Network} />
              <CardBody>
                <div className="rounded-2xl bg-ink-900 p-5 text-white">
                  <p className="text-xs font-medium uppercase tracking-wide text-white/60">{t('totalInChain')}</p>
                  <p className="mt-1 font-display text-5xl font-bold">{data.chainSize ?? 0}</p>
                  <p className="mt-1 text-sm text-white/70">{t('acrossLevels')}</p>
                </div>

                <div className="mt-3 space-y-2">
                  {data.levels?.map((l) => (
                    <div key={l.level} className="flex items-center gap-3 rounded-xl border border-ink-200 p-3.5">
                      <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-ink-100">
                        <span className="text-[10px] font-medium uppercase leading-none text-ink-400">{t('level')}</span>
                        <span className="font-display text-lg font-bold leading-tight text-ink-900">{l.level}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink-900">
                          {l.members} {l.members === 1 ? t('person') : t('people')}
                        </p>
                        <p className="text-xs text-ink-500">
                          {t('poolShare', { weight: l.weight })} · {t('ridesEarnedFrom', { count: l.rides })}
                        </p>
                      </div>
                      <span className="shrink-0 text-right">
                        <span className="block font-display text-lg font-bold text-ink-900">{l.points}</span>
                        <span className="block text-[11px] text-ink-400">{t('points')}</span>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 space-y-2 rounded-xl bg-ink-50 p-4 text-sm text-ink-600">
                  <p className="flex items-center gap-1.5 font-medium text-ink-900"><TrendingUp size={15} /> {t('howChainPays')}</p>
                  <p>
                    {t('chainExplainer')}
                  </p>
                  <p>
                    {t('chainWindow', { rides: data.config?.windowRides ?? 25 })}
                  </p>
                </div>
              </CardBody>
            </Card>

            {/* Referral code */}
            <Card>
              <CardHeader title={t('yourCode')} subtitle={t('yourCodeSubtitle')} icon={Gift} />
              <CardBody className="space-y-4">
                <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-accent/40 bg-accent-soft p-4">
                  <span className="flex-1 font-display text-2xl font-bold tracking-wider text-accent">{data.referralCode}</span>
                  <Button variant="soft" icon={Copy} onClick={() => copyCode(data.referralCode)}>{t('copy')}</Button>
                  <Button variant="soft" icon={Link2} onClick={() => copyLink(data.referralCode)}>{t('link')}</Button>
                </div>
                <Button className="w-full" size="lg" icon={Share2} onClick={() => shareLink(data.referralCode)}>
                  {t('shareInvite')}
                </Button>
                <div className="flex items-start gap-2 rounded-xl bg-ink-50 p-4 text-sm text-ink-600">
                  <Share2 size={16} className="mt-0.5 shrink-0 text-accent" />
                  <p>
                    {t('referExplainer')}
                  </p>
                </div>
              </CardBody>
            </Card>

            {/* Invite contacts */}
            <InviteContacts />

            {/* Earnings statement */}
            <Card>
              <CardHeader title={t('earnings')} subtitle={t('earningsSubtitle')} icon={Receipt} />
              <CardBody>
                {!earningsQuery.data?.length ? (
                  <EmptyState
                    icon={Receipt}
                    title={t('noEarnings')}
                    message={t('noEarningsText')}
                  />
                ) : (
                  <div className="space-y-2">
                    {earningsQuery.data.map((e) => (
                      <div key={e.id} className="flex items-center gap-3 rounded-xl border border-ink-100 p-3">
                        <Badge tone={LEVEL_TONE[e.level] || 'neutral'}>
                          {e.level === 0 ? t('rideCashback') : t('levelN', { n: e.level })}
                        </Badge>
                        <p className="min-w-0 flex-1 truncate text-sm text-ink-700">{e.level === 0 ? t('yourRide') : e.from}</p>
                        <span className="shrink-0 text-sm font-semibold text-ink-900">+{e.points}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Referred friends */}
            <Card>
              <CardHeader title={t('friendsReferred')} subtitle={t('joined', { count: data.referredCount })} icon={Users} />
              <CardBody>
                {!data.referrals?.length ? (
                  <EmptyState
                    icon={Gift}
                    title={t('noReferrals')}
                    message={t('noReferralsText', { code: data.referralCode })}
                  />
                ) : (
                  <div className="space-y-2">
                    {data.referrals.map((ref, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-xl border border-ink-100 p-3">
                        <Avatar name={ref.referred?.name || 'Friend'} size={38} />
                        <p className="font-medium text-ink-800">{ref.referred?.name || 'A friend'}</p>
                        <Badge tone="success" className="ml-auto">{t('joinedBadge')}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}

// SVG progress ring: outer track + arc showing progress to next ₹100.
// 100 points = ₹100 milestone; modulo so it resets after each full century.
function PointsRing({ points = 0 }) {
  const milestone = 100;
  const pct = Math.min((points % milestone) / milestone, 1);
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" className="shrink-0" aria-label={`${points} points, ${Math.round(pct * 100)}% to next ₹100 reward`}>
      {/* Track */}
      <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="5" />
      {/* Progress arc */}
      <circle
        cx="30" cy="30" r={r}
        fill="none"
        stroke="rgba(255,255,255,0.9)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        transform="rotate(-90 30 30)"
      />
      {/* Rupee symbol in the centre */}
      <text x="30" y="35" textAnchor="middle" fontSize="13" fontWeight="700" fill="white" fontFamily="system-ui">₹</text>
    </svg>
  );
}

// Layered concentric petal rings — the mandala motif of Rajasthan temples.
function MandalaDecoration({ className }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className={className} aria-hidden="true">
      {[48, 36, 24, 12].map((r, i) => (
        <circle key={r} cx="60" cy="60" r={r} stroke="white" strokeWidth={i % 2 === 0 ? '1.5' : '0.75'} />
      ))}
      {/* 8 radiating petals */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i * 45 * Math.PI) / 180;
        const x1 = 60 + 12 * Math.cos(angle);
        const y1 = 60 + 12 * Math.sin(angle);
        const x2 = 60 + 48 * Math.cos(angle);
        const y2 = 60 + 48 * Math.sin(angle);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="0.75" />;
      })}
    </svg>
  );
}
