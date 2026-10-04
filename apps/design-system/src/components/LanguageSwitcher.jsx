import { Languages } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { LOCALES } from '../i18n/config.js';
import { useLocale } from '../i18n/I18nProvider.jsx';

/**
 * Two-locale toggle. Each option is written in its own script, so a Hindi
 * speaker looking at an English UI can still recognise "हिन्दी".
 */
export function LanguageSwitcher({ className, compact = false }) {
  const { locale, setLocale } = useLocale();

  return (
    <div className={cn('flex items-center gap-1 rounded-full border border-ink-200 bg-white p-0.5', className)}>
      {!compact && <Languages size={14} className="ml-1.5 shrink-0 text-ink-400" />}
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLocale(l.code)}
          aria-pressed={locale === l.code}
          title={l.label}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-semibold transition-colors',
            locale === l.code ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-900'
          )}
        >
          {l.native}
        </button>
      ))}
    </div>
  );
}
