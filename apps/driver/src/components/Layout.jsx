import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth, Logo, Avatar, IconButton, Badge, LanguageSwitcher, useTranslations } from '@yatracab/ui';
import { api } from '../api.js';
import { useLocationStream } from '../hooks/useLocationStream.js';
import { Navigation, LayoutDashboard, Radio, Gavel, Route as RouteIcon, IndianRupee, User, LogOut, Wallet, Repeat, Users } from 'lucide-react';

// `bottom` marks the 4-5 items shown in the mobile bottom nav; the rest are
// reachable from the desktop top-tab row and Dashboard quick actions.
const NAV = [
  { to: '/', key: 'home', icon: LayoutDashboard, end: true, bottom: true },
  { to: '/alerts', key: 'alerts', icon: Gavel, bottom: true },
  { to: '/rides', key: 'rides', icon: RouteIcon, bottom: true },
  { to: '/wallet', key: 'wallet', icon: Wallet, bottom: true },
  { to: '/earnings', key: 'earnings', icon: IndianRupee },
  { to: '/daily-routes', key: 'routes', icon: Repeat },
  { to: '/referrals', key: 'referrals', icon: Users },
  { to: '/profile', key: 'profile', icon: User, bottom: true },
];

const BOTTOM_NAV = NAV.filter((n) => n.bottom);

export default function Layout() {
  const t = useTranslations('Nav');
  const { user, extra: driver, logout } = useAuth();
  const navigate = useNavigate();

  // Location streams from the layout, not a page, so it keeps running wherever
  // the captain navigates — and stops the moment they go offline.
  const online = Boolean(driver?.isOnline);
  const activeRide = useQuery({
    queryKey: ['driver-active-ride'],
    queryFn: () => api.get('/driver/rides?status=ongoing').then((r) => r.rides?.[0] || null),
    enabled: online,
    refetchInterval: 30000,
  });
  const { error: gpsError } = useLocationStream({ enabled: online, rideId: activeRide.data?._id });
  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-ink-100">
      <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo mark={Navigation} name="YatraCab" tagline="Captain partner" />
          <div className="flex items-center gap-2">
            {online && (
              gpsError ? (
                // Online but not actually locatable — say so, because ops and
                // riders are expecting to see this car move.
                <Badge tone="danger" dot>{gpsError === 'denied' ? 'Location off' : 'No GPS'}</Badge>
              ) : (
                <Badge tone="success" dot>
                  <Radio size={11} /> Live
                </Badge>
              )
            )}
            <Avatar name={user?.name || 'Driver'} size={38} />
            <LanguageSwitcher compact className="mr-1 hidden sm:flex" />
            <IconButton icon={LogOut} label={t('logout')} onClick={onLogout} />
          </div>
        </div>
      </header>

      <nav className="mx-auto hidden max-w-3xl flex-wrap gap-1 px-4 pt-4 sm:flex">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                isActive ? 'bg-accent text-accent-fg' : 'text-ink-500 hover:bg-ink-200/60'
              }`
            }
          >
            <n.icon size={16} /> {t(n.key)}
          </NavLink>
        ))}
      </nav>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-5 sm:pb-10">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-3xl items-stretch justify-around">
          {BOTTOM_NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                  isActive ? 'text-accent' : 'text-ink-400'
                }`
              }
            >
              <n.icon size={20} /> {t(n.key)}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
