import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth, Logo, Avatar, IconButton, LanguageSwitcher, useTranslations } from '@yatracab/ui';
import { Car, Home, ScrollText, LogOut, Users2, Gift } from 'lucide-react';

// Mobile nav shows 4 items flanking the raised Book FAB.
// Profile is reachable via the top-bar avatar link — this keeps the mobile
// rail uncluttered and the primary CTA permanently visible.
const SIDE_NAV = [
  { to: '/', key: 'home', icon: Home, end: true },
  { to: '/sharing', key: 'sharing', icon: Users2 },
  { to: '/rides', key: 'myRides', icon: ScrollText },
  { to: '/rewards', key: 'rewards', icon: Gift },
];

const DESKTOP_NAV = [
  { to: '/', key: 'home', icon: Home, end: true },
  { to: '/book', key: 'book', icon: Car },
  { to: '/sharing', key: 'sharing', icon: Users2 },
  { to: '/rides', key: 'myRides', icon: ScrollText },
  { to: '/rewards', key: 'rewards', icon: Gift },
  { to: '/profile', key: 'profile' },
];

export default function Layout() {
  const t = useTranslations('Nav');
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-ink-100">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo mark={Car} name="YatraCab" tagline="Rides, your way" />
          <div className="flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-ink-800">{user?.name || 'Rider'}</p>
              <p className="text-xs text-ink-400">{user?.phone}</p>
            </div>
            {/* Avatar doubles as profile link on mobile where profile isn't in the bottom nav */}
            <Link to="/profile" aria-label={t('profile')}>
              <Avatar name={user?.name || 'You'} size={38} />
            </Link>
            <LanguageSwitcher compact className="mr-1 hidden sm:flex" />
            <IconButton icon={LogOut} label={t('logout')} onClick={onLogout} />
          </div>
        </div>
      </header>

      {/* Desktop tabs */}
      <nav className="mx-auto hidden max-w-3xl gap-1 px-4 pt-4 sm:flex">
        {DESKTOP_NAV.map((n) => (
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
            {n.icon && <n.icon size={16} />} {t(n.key)}
          </NavLink>
        ))}
      </nav>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-5 sm:pb-10">
        <Outlet />
      </main>

      {/* Mobile bottom nav — raised center FAB for Book */}
      <nav className="fixed inset-x-0 bottom-0 z-30 bg-white/95 backdrop-blur sm:hidden">
        {/* Subtle gradient top border instead of a hard line */}
        <div className="h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent" />
        <div className="mx-auto flex max-w-3xl items-center px-2">
          {/* Left two items */}
          {SIDE_NAV.slice(0, 2).map((n) => (
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
              {({ isActive }) => (
                <>
                  <span className={`relative flex h-7 w-7 items-center justify-center rounded-xl transition-all ${isActive ? 'bg-accent-soft' : ''}`}>
                    <n.icon size={18} />
                    {isActive && <span className="absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />}
                  </span>
                  <span>{t(n.key)}</span>
                </>
              )}
            </NavLink>
          ))}

          {/* Raised Book FAB — the primary CTA, always visible */}
          <div className="relative flex flex-col items-center px-2 pb-1">
            <Link
              to="/book"
              className="relative flex -translate-y-4 flex-col items-center"
            >
              {/* Outer glow ring — subtle pulse */}
              <span className="absolute inset-0 animate-pulse rounded-2xl bg-brand-gradient opacity-20" />
              <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow transition-transform active:scale-95 hover:shadow-glow-lg">
                <Car size={24} className="text-accent-fg" />
              </span>
              <span className="mt-1 text-[10px] font-semibold text-accent">{t('book')}</span>
            </Link>
          </div>

          {/* Right two items */}
          {SIDE_NAV.slice(2, 4).map((n) => (
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
              {({ isActive }) => (
                <>
                  <span className={`relative flex h-7 w-7 items-center justify-center rounded-xl transition-all ${isActive ? 'bg-accent-soft' : ''}`}>
                    <n.icon size={18} />
                    {isActive && <span className="absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />}
                  </span>
                  <span>{t(n.key)}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
