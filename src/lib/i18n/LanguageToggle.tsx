'use client';

import { useLanguage } from './LanguageContext';
import type { Locale } from './locales';

/** Compact EN / VI toggle. Place in nav bars (home header, PlayerHud). */
export default function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLanguage();
  const next: Locale = locale === 'en' ? 'vi' : 'en';
  void compact;
  return (
    <button
      className="btn h-10 w-14 shrink-0 overflow-hidden !gap-0 !p-0"
      onClick={() => setLocale(next)}
      title={t('common.language')}
      aria-label={t('common.language')}
    >
      {next === 'vi' ? <FlagVN /> : <FlagGB />}
    </button>
  );
}

function FlagVN() {
  return (
    <svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="block h-full w-full">
      <rect width="30" height="20" fill="#DA251D" />
      <path
        d="M15 4.6l1.32 4.07h4.28l-3.46 2.51 1.32 4.07-3.46-2.51-3.46 2.51 1.32-4.07-3.46-2.51h4.28z"
        fill="#FFDE00"
      />
    </svg>
  );
}

function FlagGB() {
  return (
    <svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="block h-full w-full">
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#C8102E" strokeWidth="1.6" />
      <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6.6" />
      <path d="M15 0v20M0 10h30" stroke="#C8102E" strokeWidth="4" />
    </svg>
  );
}
