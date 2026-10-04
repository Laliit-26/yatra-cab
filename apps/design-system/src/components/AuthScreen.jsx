import { useState } from 'react';
import { ArrowRight, ArrowLeft, ShieldCheck } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Button } from './Button.jsx';
import { Field, Input } from './Field.jsx';
import { Segmented, Logo } from './Misc.jsx';
import toast from 'react-hot-toast';
import { useTranslations } from '../i18n/I18nProvider.jsx';
import { LanguageSwitcher } from './LanguageSwitcher.jsx';

/**
 * Shared auth experience for every portal: a gradient hero panel + a glass
 * card with an explicit Sign in / Create account flow (phone + OTP).
 *
 * Props:
 *  - api            the app's API client
 *  - role           'customer' | 'driver' | 'admin'
 *  - allowSignup    show the Create-account tab (false for admin)
 *  - brand          { mark, name, tagline }
 *  - hero           { title, subtitle, highlights:[{icon,title,text}] }
 *  - roleNoun       e.g. 'Rider', 'Captain', 'Admin'
 *  - demoHint       small text under the form
 *  - onAuthed(user, accessToken)
 */
export function AuthScreen({ api, role, allowSignup = true, brand, hero, roleNoun = 'account', demoHint, onAuthed }) {
  const t = useTranslations('Auth');
  const [mode, setMode] = useState(() =>
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('ref') || sessionStorage.getItem('yc_ref'))
      ? 'signup'
      : 'signin'
  ); // signin | signup
  const [step, setStep] = useState('form'); // form | otp
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // Prefill from a share link: /?ref=RADXY7
  const [referralCode, setReferralCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    const fromUrl = new URLSearchParams(window.location.search).get('ref');
    return (fromUrl || sessionStorage.getItem('yc_ref') || '').toUpperCase();
  });
  const [busy, setBusy] = useState(false);
  const [devOtp, setDevOtp] = useState(null);

  const isSignup = mode === 'signup';

  const requestOtp = async (e) => {
    e.preventDefault();
    if (!/^\+?[0-9]{10,13}$/.test(phone)) return toast.error(t('invalidPhone'));
    if (isSignup && !name.trim()) return toast.error(t('needName'));
    setBusy(true);
    try {
      const res = await api.post('/auth/request-otp', { phone, email: email || undefined });
      setDevOtp(res.devOtp || null);
      setStep('otp');
      toast.success(res.message || t('otpSent'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    if (!/^[0-9]{6}$/.test(code)) return toast.error(t('needOtp'));
    setBusy(true);
    try {
      const body = { phone, code };
      if (role !== 'admin') body.role = role;
      if (isSignup) {
        body.name = name || undefined;
        body.email = email || undefined;
        body.referralCode = referralCode.trim() || undefined;
      }
      const res = await api.post('/auth/verify-otp', body);
      await onAuthed(res.user, res.accessToken);
      toast.success(`${t('welcome')}${res.user?.name ? `, ${res.user.name}` : ''}!`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Hero panel */}
      <div className="relative hidden overflow-hidden bg-brand-gradient p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="yc-blob -left-16 -top-10 h-72 w-72 bg-white/25" />
        <div className="yc-blob bottom-0 right-0 h-80 w-80 bg-black/20" style={{ animationDelay: '3s' }} />
        <div className="pointer-events-none absolute inset-0 bg-dotted opacity-30" />

        <div className="relative">
          <Logo
            mark={brand.mark}
            name={brand.name}
            tagline={brand.tagline}
            className="[&_p:first-child]:text-white [&_p:last-child]:text-white/70 [&>span]:bg-white/15 [&>span]:shadow-none"
          />
        </div>
        <div className="relative animate-slide-up">
          <h1 className="whitespace-pre-line font-display text-[2.6rem] font-extrabold leading-[1.1] tracking-tight">{hero.title}</h1>
          <p className="mt-4 max-w-md text-lg text-white/80">{hero.subtitle}</p>
          <div className="mt-9 space-y-4">
            {hero.highlights?.map((h) => (
              <div key={h.title} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                  <h.icon size={19} />
                </span>
                <div>
                  <p className="font-semibold">{h.title}</p>
                  <p className="text-sm text-white/70">{h.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative flex items-center gap-1.5 text-sm text-white/55">
          <ShieldCheck size={14} /> {t('footer')}
        </p>
      </div>

      {/* Form panel */}
      <div className="relative flex items-center justify-center overflow-hidden bg-ink-100 p-6">
        <div className="yc-blob -right-24 top-10 h-64 w-64 bg-accent/20 lg:hidden" />
        <div className="relative w-full max-w-sm animate-fade-in">
          <div className="mb-7 lg:hidden">
            <Logo mark={brand.mark} name={brand.name} tagline={brand.tagline} />
          </div>

          <div className="mb-3 flex justify-end">
            <LanguageSwitcher />
          </div>

          <div className="rounded-3xl border border-white/60 bg-white/80 p-7 shadow-soft backdrop-blur">
            {step === 'form' ? (
              <form onSubmit={requestOtp} className="space-y-4">
                <div>
                  <h2 className="font-display text-2xl font-bold text-ink-900">
                    {allowSignup ? (isSignup ? t('createAccount') : t('welcomeBack')) : `${roleNoun} sign in`}
                  </h2>
                  <p className="mt-1 text-sm text-ink-500">{t('otpHint')}</p>
                </div>

                {allowSignup && (
                  <Segmented
                    className="w-full [&>button]:flex-1"
                    value={mode}
                    onChange={(m) => setMode(m)}
                    options={[{ value: 'signin', label: t('signIn') }, { value: 'signup', label: t('createAccountTab') }]}
                  />
                )}

                {isSignup && (
                  <Field label={t('fullName')}>
                    <Input placeholder={t('namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                  </Field>
                )}
                <Field label={t('phone')}>
                  <Input inputMode="numeric" placeholder="9000000010" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus={!isSignup} />
                </Field>
                {isSignup && (
                  <Field label={t('email')} hint={t('emailHint')}>
                    <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Field>
                )}
                {isSignup && role === 'customer' && (
                  <Field label={t('referralCode')} hint={t('optional', {})}>
                    <Input
                      placeholder={t('referralPlaceholder')}
                      maxLength={12}
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                      className="tracking-widest"
                    />
                  </Field>
                )}

                <Button type="submit" className="w-full" size="lg" loading={busy} icon={ArrowRight}>
                  {isSignup ? t('createAccountTab') : t('sendOtp')}
                </Button>
                {demoHint && <p className="text-center text-xs text-ink-400">{demoHint}</p>}
              </form>
            ) : (
              <form onSubmit={verify} className="space-y-4">
                <button type="button" onClick={() => setStep('form')} className="flex items-center gap-1 text-sm text-ink-500 transition-colors hover:text-ink-700">
                  <ArrowLeft size={15} /> {t('back')}
                </button>
                <div>
                  <h2 className="font-display text-2xl font-bold text-ink-900">{t('enterCode')}</h2>
                  <p className="mt-1 text-sm text-ink-500">{t('sentTo', { phone })}</p>
                </div>
                {devOtp && (
                  <div className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
                    {t('devOtp')} <span className="font-semibold tracking-[0.3em]">{devOtp}</span>
                  </div>
                )}
                <Field label={t('otpLabel')}>
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="______"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className={cn('text-center text-2xl font-semibold tracking-[0.5em]')}
                    autoFocus
                  />
                </Field>
                <Button type="submit" className="w-full" size="lg" loading={busy}>{t('verify')}</Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
