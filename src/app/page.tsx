'use client';

import { ArrowRight, Bot, Gamepad2, Gift, Globe, Palette, Shield, Star, Swords, Trophy, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import WorldChat from '@/components/chat/WorldChat';
import GameTitle from '@/components/home/GameTitle';
import HeroBanner from '@/components/home/HeroBanner';
import Reveal from '@/components/home/Reveal';
import PlayerHud from '@/components/player/PlayerHud';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { IS_VERCEL } from '@/shared/deploy';

export default function Home() {
  const { t } = useLanguage();

  const MODES = [
    {
      href: '/play?mode=bot',
      title: t('modes.botTitle'),
      desc: t('modes.botDesc'),
      icon: Bot,
      ribbon: t('modes.botRibbon'),
      ribbonCls: 'bg-[#ffc233] text-[#2d3232]',
      ring: 'hover:shadow-[#ffc233]/40',
      iconBg: 'bg-gradient-to-b from-[#ffd76a] to-[#f59e0b]',
      cta: 'text-[#b25b00]',
    },
    {
      href: '/play?mode=local',
      title: t('modes.localTitle'),
      desc: t('modes.localDesc'),
      icon: Gamepad2,
      ribbon: t('modes.localRibbon'),
      ribbonCls: 'bg-[#2f6fe0] text-white',
      ring: 'hover:shadow-[#2f6fe0]/40',
      iconBg: 'bg-gradient-to-b from-[#6aa6ff] to-[#2f6fe0]',
      cta: 'text-[#2f6fe0]',
    },
    {
      href: '/play?mode=online',
      title: t('modes.onlineTitle'),
      desc: t('modes.onlineDesc'),
      icon: Globe,
      online: true,
      ribbon: t('modes.onlineRibbon'),
      ribbonCls: 'bg-[#d8373a] text-white',
      ring: 'hover:shadow-[#d8373a]/40',
      iconBg: 'bg-gradient-to-b from-[#ff7a7a] to-[#d8373a]',
      cta: 'text-[#d8373a]',
    },
    {
      href: '/play?mode=ranked',
      title: t('modes.rankedTitle'),
      desc: t('modes.rankedDesc'),
      icon: Trophy,
      online: true,
      ribbon: t('modes.rankedRibbon'),
      ribbonCls: 'bg-[#7c3aed] text-white',
      ring: 'hover:shadow-[#7c3aed]/40',
      iconBg: 'bg-gradient-to-b from-[#c084fc] to-[#7c3aed]',
      cta: 'text-[#7c3aed]',
    },
  ].filter((m) => !(IS_VERCEL && (m as { online?: boolean }).online));

  const STEPS = [
    { n: '01', icon: Shield, title: t('steps.s1Title'), desc: t('steps.s1Desc') },
    { n: '02', icon: Swords, title: t('steps.s2Title'), desc: t('steps.s2Desc') },
    { n: '03', icon: Trophy, title: t('steps.s3Title'), desc: t('steps.s3Desc') },
  ];

  const TICKER: Array<[LucideIcon, string]> = [
    [Swords, t('home.tickerDeploy')],
    [Bot, t('home.tickerAi')],
    ...(IS_VERCEL ? [] : [[Globe, t('home.tickerOnline')] as [LucideIcon, string]]),
    [Palette, t('home.tickerWorkshop')],
    [Gift, t('home.tickerGift')],
    ...(IS_VERCEL ? [] : [[Trophy, t('home.tickerRank')] as [LucideIcon, string]]),
  ];

  return (
    <main className="game-ui home-page relative min-h-screen bg-[#1a1446]">
      {/* ===== NAV BAR ===== */}
      <header className="sticky top-0 z-20 border-b-[3px] border-[#2d3232] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2">
          <Link href="/" className="flex min-w-0 shrink items-center gap-2">
            <span className="bounce-soft inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[#2d3232] bg-gradient-to-b from-[#ffd76a] to-[#f59e0b] text-2xl shadow-[0_3px_0_0_#2d3232]">
              <Swords />
            </span>
            <span className="min-w-0 leading-none">
              <span className="block truncate text-base tracking-wide sm:text-lg">MINI BATTLE</span>
              <span className="block truncate text-sm text-[#b25b00]">SIMULATOR</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-4 md:flex" aria-label={t('nav.navLabel')}>
            <a href="#choi-ngay" className="rounded-lg px-2 py-1 transition hover:bg-[#ffe9b8]">
              {t('nav.playNow')}
            </a>
            <a href="#cach-choi" className="rounded-lg px-2 py-1 transition hover:bg-[#ffe9b8]">
              {t('nav.howTo')}
            </a>
            <a href="#tinh-nang" className="rounded-lg px-2 py-1 transition hover:bg-[#ffe9b8]">
              {t('nav.features')}
            </a>
          </nav>
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <PlayerHud />
          </div>
        </div>
      </header>

      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#241a6e] via-[#5b2ee5] to-[#8b5cf6]">
        <HeroBanner>
          <div className="relative mx-auto flex max-w-5xl flex-col items-center px-4 pb-28 pt-8 text-center sm:pb-48 sm:pt-10">
            <span className="reward-pop inline-flex items-center gap-2 rounded-full border-2 border-[#2d3232] bg-[#ffc233] px-4 py-1 shadow-[0_4px_0_0_#2d3232]">
              <Star /> {t('home.badge')} <Star />
            </span>
            <GameTitle />
            <p className="mt-2 max-w-xl rounded-2xl border-2 border-white/40 bg-black/25 px-4 py-2 text-lg text-white">
              {t('home.subtitle')}
            </p>
            <div className="mt-8 flex justify-center">
              <a href="#choi-ngay" className="btn btn-gold hero-play px-10 py-4 text-2xl sm:px-14 sm:py-5 sm:text-4xl">
                <Swords /> {t('home.ctaPlay')}
              </a>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[#2d3232]">
              {(
                [
                  [Swords, IS_VERCEL ? t('home.modesBadge2') : t('home.modesBadge3')],
                  [Bot, t('home.aiBadge')],
                  ...(IS_VERCEL ? [] : [[Globe, t('home.onlineBadge')]]),
                ] as Array<[LucideIcon, string]>
              ).map(([Icon, b]) => (
                <span key={b} className="rounded-full border-2 border-[#2d3232] bg-white px-3 py-1 shadow-[0_3px_0_0_#2d3232]">
                  <Icon /> {b}
                </span>
              ))}
            </div>
          </div>
        </HeroBanner>
      </section>

      {/* ===== TICKER ===== */}
      <div className="overflow-hidden border-y-[3px] border-[#2d3232] bg-[#ffc233] py-2" id="tinh-nang" aria-hidden>
        <div className="marquee-track gap-8 pr-8">
          {[...TICKER, ...TICKER].map(([Icon, txt], i) => (
            <span key={i} className="whitespace-nowrap text-base text-[#2d3232] sm:text-xl">
              <Icon /> {txt} <span className="ml-6">•</span>
            </span>
          ))}
        </div>
      </div>

      {/* ===== MODES ===== */}
      <section id="choi-ngay" className="relative bg-gradient-to-b from-[#ff8a1e] via-[#ff9d2e] to-[#ffb300] pb-14 pt-10">
        <div className="mx-auto max-w-6xl px-4">
          <Reveal>
            <h2 className="text-outline text-center text-3xl sm:text-5xl">{t('home.modesTitle')}</h2>
            <p className="mx-auto mt-2 max-w-xl rounded-xl bg-black/25 px-3 py-1 text-center text-lg text-white drop-shadow-[0_2px_0_#2d3232]">
              {IS_VERCEL ? t('home.modesSubtitle2') : t('home.modesSubtitle4')}
            </p>
          </Reveal>
          <div className={`mt-8 grid w-full gap-6 sm:grid-cols-2 ${IS_VERCEL ? 'mx-auto max-w-3xl' : 'lg:grid-cols-4'}`}>
            {MODES.map((m, i) => (
              <Reveal key={m.href} variant="up" delay={(i % 4) * 110} className="h-full">
              <Link
                href={m.href}
                className={`mode-card group relative flex h-full flex-col overflow-hidden rounded-3xl border-[3px] border-[#2d3232] bg-white shadow-[0_8px_0_0_#2d3232] hover:shadow-[0_14px_0_0_#2d3232] ${m.ring}`}
              >
                <span className={`absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] truncate rounded-full border-2 border-[#2d3232] px-3 py-0.5 text-sm ${m.ribbonCls}`}>
                  {m.ribbon}
                </span>
                <span className={`flex items-center justify-center pb-6 pt-12 ${m.iconBg}`}>
                  <span className="bounce-soft inline-flex h-24 w-24 items-center justify-center rounded-full border-[3px] border-[#2d3232] bg-white text-6xl shadow-[0_5px_0_0_#2d3232]">
                    <m.icon />
                  </span>
                </span>
                <span className="flex flex-1 flex-col gap-1 p-5 text-left">
                  <span className="text-2xl">{m.title}</span>
                  <span className="opacity-80">{m.desc}</span>
                  <span className={`mode-cta mt-3 inline-flex items-center gap-1 text-xl ${m.cta}`}>
                    {t('home.playNow')} <ArrowRight aria-hidden />
                  </span>
                </span>
              </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <div className="zigzag bg-[#ffb300]" style={{ ['--zz' as string]: '#fff' }} aria-hidden />

      {/* ===== HOW TO ===== */}
      <section id="cach-choi" className="bg-white py-12">
        <div className="mx-auto max-w-6xl px-4">
          <Reveal>
            <h2 className="text-center text-3xl sm:text-4xl">
              <Swords /> {t('home.stepsTitleA')} <span className="text-[#f59e0b]">{t('home.stepsTitleB')}</span>
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} variant={i === 1 ? 'zoom' : i === 0 ? 'left' : 'right'} delay={i * 110} className="h-full">
              <div className="relative h-full rounded-3xl border-[3px] border-[#2d3232] bg-[#f6eedb] p-5 pt-8 text-center shadow-[0_6px_0_0_#2d3232]">
                <span className="absolute -top-5 left-1/2 inline-flex h-10 w-16 -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-[#2d3232] bg-[#5b2ee5] text-lg text-white">
                  {s.n}
                </span>
                <div className="text-5xl">
                  <s.icon />
                </div>
                <h3 className="mt-2 text-2xl">{s.title}</h3>
                <p className="mt-1 opacity-80">{s.desc}</p>
              </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA + FOOTER ===== */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#5b2ee5] to-[#241a6e] py-12 text-center">
        <div className="hero-dots absolute inset-0 opacity-40" aria-hidden />
        <Reveal variant="zoom" className="relative mx-auto max-w-2xl px-4">
          <h2 className="text-outline text-3xl sm:text-5xl">{t('home.ctaTitle')}</h2>
          <p className="mt-2 rounded-xl bg-black/25 px-3 py-1 text-lg text-white">{t('home.ctaDesc')}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/play?mode=bot" className="btn btn-gold max-w-full break-words px-6 py-3 text-xl sm:px-8 sm:text-2xl">
              <Swords /> {t('home.ctaPlay')}
            </Link>
          </div>
        </Reveal>
      </section>
      <footer className="border-t-[3px] border-[#2d3232] bg-[#14102e] py-5 text-center text-white/80">
        <p><Swords /> {t('home.footer')}</p>
      </footer>

      <WorldChat />
    </main>
  );
}
