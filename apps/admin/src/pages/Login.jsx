import { useNavigate } from 'react-router-dom';
import { useAuth, AuthScreen } from '@yatracab/ui';
import { ShieldCheck, BadgeCheck, BarChart3, Route as RouteIcon } from 'lucide-react';
import { api } from '../api.js';

const HERO = {
  title: 'Operations,\nunder control.',
  subtitle: 'Verify drivers, manage fares, monitor bookings and revenue — the trust layer behind every YatraCab ride.',
  highlights: [
    { icon: BadgeCheck, title: 'Driver verification', text: 'Review documents and approve drivers before they go live.' },
    { icon: RouteIcon, title: 'Pricing engine', text: 'Tune fixed fares, floor prices and surge across every route.' },
    { icon: BarChart3, title: 'Live operations', text: 'Track rides, revenue and cancellations in real time.' },
  ],
};

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  return (
    <AuthScreen
      api={api}
      role="admin"
      allowSignup={false}
      roleNoun="Admin"
      brand={{ mark: ShieldCheck, name: 'YatraCab Ops', tagline: 'Admin console' }}
      hero={HERO}
      demoHint="Demo admin: 9000000001 — the code appears on the next screen"
      onAuthed={async (user, token) => {
        await login(user, token);
        navigate('/');
      }}
    />
  );
}
