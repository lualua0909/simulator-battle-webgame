'use client';

import { useLanguage } from './LanguageContext';
import type { Locale } from './locales';

/** Compact EN / VI toggle. Place in nav bars (home header, PlayerHud). */
export default function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLanguage();
  const next: Locale = locale === 'en' ? 'vi' : 'en';
  return (
    <button
      className="btn min-h-[40px] min-w-[44px] shrink-0 px-2.5 py-1 text-lg"
      onClick={() => setLocale(next)}
      title={t('common.language')}
      aria-label={t('common.language')}
    >
      {compact ? (locale === 'en' ? 'VI' : 'EN') : locale === 'en' ? '🇻🇳 VI' : '🇬🇧 EN'}
    </button>
  );
}
