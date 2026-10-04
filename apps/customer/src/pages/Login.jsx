import { useNavigate } from 'react-router-dom';
import { useAuth, AuthScreen, useTranslations } from '@yatracab/ui';
import { Car, ShieldCheck, BadgeIndianRupee, Gavel } from 'lucide-react';
import { api } from '../api.js';


export default function Login() {
  const t = useTranslations('Auth');
  const { login } = useAuth();

  const hero = {
    title: t('heroTitle'),
    subtitle: t('heroSubtitle'),
    highlights: [
      { icon: ShieldCheck, title: t('verifiedDrivers'), text: t('verifiedDriversText') },
      { icon: BadgeIndianRupee, title: t('transparentPricing'), text: t('transparentPricingText') },
      { icon: Gavel, title: t('youChoose'), text: t('youChooseText') },
    ],
  };
  const navigate = useNavigate();

  return (
    <AuthScreen
      api={api}
      role="customer"
      roleNoun="Rider"
      brand={{ mark: Car, name: 'YatraCab', tagline: 'Rides, your way' }}
      hero={hero}
      demoHint="Demo rider: 9000000010 — the code appears on the next screen"
      onAuthed={async (user, token) => {
        await login(user, token);
        navigate('/');
      }}
    />
  );
}
