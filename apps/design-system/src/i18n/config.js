// Language config. Mirrors the Affiliates frontend's next-intl setup (a locale
// list + a default), but the runtime is our own since this is Vite, not Next.
export const LOCALES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
];

export const DEFAULT_LOCALE = 'en';
export const STORAGE_KEY = 'yc_locale';

export const isSupported = (code) => LOCALES.some((l) => l.code === code);

/** Saved choice first, then the browser's language, then English. */
export function detectLocale() {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isSupported(saved)) return saved;
  } catch {
    /* private mode — fall through to browser detection */
  }
  const nav = (navigator.languages?.[0] || navigator.language || '').slice(0, 2).toLowerCase();
  return isSupported(nav) ? nav : DEFAULT_LOCALE;
}
