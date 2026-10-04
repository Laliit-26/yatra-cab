import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth, Logo, Avatar, IconButton } from '@yatracab/ui';
import {
  ShieldCheck, LayoutDashboard, BadgeCheck, Car, Users, ClipboardList,
  Route as RouteIcon, BarChart3, ShieldAlert, Wallet, LogOut, Menu, X, Radio, Ticket } from 'lucide-react';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/verification', label: 'Verification', icon: BadgeCheck },
  { to: '/live', label: 'Live map', icon: Radio },
  { to: '/drivers', label: 'Drivers', icon: Car },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/bookings', label: 'Bookings', icon: ClipboardList },
  { to: '/routes', label: 'Routes & Fares', icon: RouteIcon },
  { to: '/coupons', label: 'Coupons', icon: Ticket },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/safety', label: 'Safety', icon: ShieldAlert },
  { to: '/finance', label: 'Finance', icon: Wallet },
];

function NavItems({ onNavigate }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              isActive ? 'bg-accent text-accent-fg shadow-sm' : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800'
            }`
          }
        >
          <n.icon size={18} /> {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  const Sidebar = ({ onNavigate }) => (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Logo mark={ShieldCheck} name="YatraCab Ops" tagline="Admin console" />
      </div>
      <div className="flex-1 overflow-y-auto px-3">
        <NavItems onNavigate={onNavigate} />
      </div>
      <div className="border-t border-ink-100 p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <Avatar name={user?.name || 'Admin'} size={38} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink-800">{user?.name || 'Admin'}</p>
            <p className="truncate text-xs text-ink-400">{user?.phone}</p>
          </div>
          <IconButton icon={LogOut} label="Log out" onClick={onLogout} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-100">
      {/* Fixed desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-ink-200/70 bg-white lg:block">
        <Sidebar />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-200/70 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo mark={ShieldCheck} name="YatraCab Ops" tagline="Admin console" />
        <IconButton icon={Menu} label="Open menu" onClick={() => setMobileOpen(true)} />
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[80%] bg-white shadow-pop animate-scale-in">
            <div className="flex justify-end p-2">
              <IconButton icon={X} label="Close menu" onClick={() => setMobileOpen(false)} />
            </div>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8 animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
