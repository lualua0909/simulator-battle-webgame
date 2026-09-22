// Locale types + helpers. Default locale is English ('en') to reach foreign players;
// Vietnamese ('vi') remains available via the language toggle.
export type Locale = 'en' | 'vi';

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALES: Locale[] = ['en', 'vi'];
export const LOCALE_STORAGE_KEY = 'mbs-locale';

export function normalizeLocale(v: unknown): Locale {
  return v === 'vi' ? 'vi' : 'en';
}
