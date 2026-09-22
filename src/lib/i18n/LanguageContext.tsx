'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en, { type UIDict } from './en';
import vi from './vi';
import { BOT_EN, FACTION_EN, MAP_EN, UNIT_EN, WEAPON_EN } from './content-en';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, normalizeLocale, type Locale } from './locales';

const DICTS: Record<Locale, UIDict> = { en, vi };

type DotPath<T> = T extends string
  ? ''
  : T extends object
    ? { [K in Extract<keyof T, string>]: K | `${K}.${DotPath<T[K]>}` }[Extract<keyof T, string>]
    : '';

export type TKey = Exclude<DotPath<UIDict>, ''>;

function get(obj: unknown, path: string): string {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return path;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : path;
}

interface LanguageCtx {
  locale: Locale;
  setLocale(l: Locale): void;
  t(key: TKey): string;
  /** Localized display name for game content. Falls back to stored (Vietnamese) name. */
  unitName(id: string, fallback: string): string;
  unitDesc(id: string, fallback: string): string;
  factionName(id: string, fallback: string): string;
  weaponName(id: string, fallback: string): string;
  mapName(id: string, fallback: string): string;
  botName(id: string, fallback: string): string;
  botDesc(id: string, fallback: string): string;
}

const Ctx = createContext<LanguageCtx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const saved = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
      // Only honor an explicitly saved choice; otherwise stay on English default.
      const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
      setLocaleState(raw ? saved : DEFAULT_LOCALE);
    } catch {
      setLocaleState(DEFAULT_LOCALE);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'vi' ? 'vi' : 'en';
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
  }, [locale]);

  const setLocale = useCallback((l: Locale) => setLocaleState(normalizeLocale(l)), []);
  const dict = DICTS[locale] ?? en;
  const t = useCallback((key: TKey) => get(dict, key), [dict]);

  const value = useMemo<LanguageCtx>(
    () => ({
      locale,
      setLocale,
      t,
      unitName: (id, fallback) => (locale === 'en' ? (UNIT_EN[id]?.name ?? fallback) : fallback),
      unitDesc: (id, fallback) => (locale === 'en' ? (UNIT_EN[id]?.description ?? fallback) : fallback),
      factionName: (id, fallback) => (locale === 'en' ? (FACTION_EN[id] ?? fallback) : fallback),
      weaponName: (id, fallback) => (locale === 'en' ? (WEAPON_EN[id] ?? fallback) : fallback),
      mapName: (id, fallback) => (locale === 'en' ? (MAP_EN[id] ?? fallback) : fallback),
      botName: (id, fallback) => (locale === 'en' ? (BOT_EN[id]?.name ?? fallback) : fallback),
      botDesc: (id, fallback) => (locale === 'en' ? (BOT_EN[id]?.description ?? fallback) : fallback),
    }),
    [locale, setLocale, t],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLanguage(): LanguageCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback for server components / outside provider: English defaults.
    const t = (key: TKey) => get(en, key);
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t,
      unitName: (id, fallback) => UNIT_EN[id]?.name ?? fallback,
      unitDesc: (id, fallback) => UNIT_EN[id]?.description ?? fallback,
      factionName: (id, fallback) => FACTION_EN[id] ?? fallback,
      weaponName: (id, fallback) => WEAPON_EN[id] ?? fallback,
      mapName: (id, fallback) => MAP_EN[id] ?? fallback,
      botName: (id, fallback) => BOT_EN[id]?.name ?? fallback,
      botDesc: (id, fallback) => BOT_EN[id]?.description ?? fallback,
    };
  }
  return ctx;
}
