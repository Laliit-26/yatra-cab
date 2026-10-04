import { useNavigate } from 'react-router-dom';
import { useAuth, AuthScreen, useTranslations } from '@yatracab/ui';
import { Navigation, IndianRupee, TrendingUp, Award } from 'lucide-react';
import { api } from '../api.js';


export default function Login() {
  const t = useTranslations('Auth');
  const { login } = useAuth();

  const hero = {
    title: t('driverHeroTitle'),
    subtitle: t('driverHeroSubtitle'),
    highlights: [
      { icon: IndianRupee, title: t('keepFullFare'), text: t('keepFullFareText') },
      { icon: TrendingUp, title: t('steadyDemand'), text: t('steadyDemandText') },
      { icon: Award, title: t('loyaltyRewards'), text: t('loyaltyRewardsText') },
    ],
  };
  const navigate = useNavigate();

  return (
    <AuthScreen
      api={api}
      role="driver"
      roleNoun="Captain"
      brand={{ mark: Navigation, name: 'YatraCab', tagline: 'Captain partner' }}
      hero={hero}
      demoHint="Demo: 9000000020 (approved) · 9000000023 (pending) — code shown on the next screen"
      onAuthed={async (user, token) => {
        await login(user, token);
        navigate('/');
      }}
    />
  );
}
