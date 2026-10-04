import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './messages/en.json';
import hi from './messages/hi.json';
import { DEFAULT_LOCALE, STORAGE_KEY, detectLocale, isSupported } from './config.js';

// Messages are bundled rather than fetched: two locales of UI copy is a few KB,
// and this keeps the first paint free of a translation round-trip.
const MESSAGES = { en, hi };

const I18nContext = createContext(null);

/** Walk "a.b.c" through a nested message object. */
const lookup = (tree, path) =>
  path.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), tree);

/** Fill {name} placeholders: t('greeting', { name: 'Radha' }). */
const interpolate = (str, values) =>
  values
    ? str.replace(/\{(\w+)\}/g, (match, key) => (values[key] != null ? String(values[key]) : match))
    : str;

export function I18nProvider({ children, initialLocale }) {
  const [locale, setLocaleState] = useState(() => initialLocale || detectLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* private mode — the choice just won't persist */
    }
  }, [locale]);

  const setLocale = useCallback((code) => {
    if (isSupported(code)) setLocaleState(code);
  }, []);

  const translate = useCallback(
    (key, values) => {
      // Fall back to English, then to the key itself, so a missing Hindi string
      // shows readable English rather than a blank or a raw key.
      const hit = lookup(MESSAGES[locale], key) ?? lookup(MESSAGES[DEFAULT_LOCALE], key);
      if (typeof hit !== 'string') {
        if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
        return key;
      }
      return interpolate(hit, values);
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, translate }), [locale, setLocale, translate]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Namespaced translator, same shape as the Affiliates frontend:
 *   const t = useTranslations('Book');
 *   t('title')            → messages.Book.title
 *   t('fare', { n: 500 }) → interpolates {n}
 */
export function useTranslations(namespace) {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslations must be used inside <I18nProvider>');
  const { translate } = ctx;
  return useCallback(
    (key, values) => translate(namespace ? `${namespace}.${key}` : key, values),
    [translate, namespace]
  );
}

/** Locale state for the language switcher. */
export function useLocale() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useLocale must be used inside <I18nProvider>');
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}
