'use client';

// Card collection: every unit as a card with its stars and cards; unlock, upgrade and buy cards
// with coins. Buttons only send the request: the wallet shown afterwards is the server's answer.
import { ArrowRight, ArrowUp, LockOpen, User, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatCoins, isUnlocked, nextStar, starScale, type PlayerAction } from '@/shared/economy';
import { STAR_MAX, type ConfigBundle, type UnitDef } from '@/shared/schema';
import { unitPower } from '@/game/bot/generate';
import { useAuth } from '@/components/auth/AuthProvider';
import { NamedIcon } from '@/components/ui/NamedIcon';
import { CoinIcon, Stars } from './icons';
import { CoinBar } from './PlayerHud';
import { usePlayer } from './PlayerProvider';
import UnitCard from './UnitCard';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface Props {
  bundle: ConfigBundle;
  thumbs: Record<string, string>;
  onClose(): void;
}

export default function Collection({ bundle, thumbs, onClose }: Props) {
  const { t, locale, factionName } = useLanguage();
  const ROLE_LABEL: Record<UnitDef['role'], string> = { melee: t('palette.melee'), ranged: t('palette.ranged'), support: t('palette.support'), siege: t('palette.siege') };
  const { user, openAuth } = useAuth();
  const { player } = usePlayer();
  const factions = useMemo(() => [...bundle.factions].sort((a, b) => a.order - b.order), [bundle]);
  const [tab, setTab] = useState('all');
  const units = useMemo(
    () =>
      bundle.units
        .filter((u) => tab === 'all' || u.factionId === tab)
        .sort((a, b) => Number(isUnlocked(b, player)) - Number(isUnlocked(a, player)) || a.cost - b.cost),
    [bundle, tab, player],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = bundle.units.find((u) => u.id === selectedId) ?? null;
  // Desktop keeps a persistent side panel; mobile only shows a popup after a tap.
  const desktopSelected = selected ?? units[0] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedId) setSelectedId(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, selectedId]);

  // Lock the page behind the full-screen modal so only the collection scrolls on mobile.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <>
      <div className="game-ui box-backdrop fixed inset-0 z-40 flex flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-3 sm:px-4">
          <h2 className="text-outline min-w-0 text-xl sm:text-2xl md:text-3xl">{t('collection.title')}</h2>
          <div className="order-1 ml-auto mr-4 flex min-w-0 shrink-0 items-center gap-3">
            {user && <CoinBar value={player?.coins ?? 0} />}
          </div>
          <button className="btn order-2 shrink-0 px-2.5 py-1 text-xl" onClick={onClose} aria-label={t('common.close')}>
            <X />
          </button>
          <div className="order-3 flex max-w-full basis-full flex-nowrap gap-1 overflow-x-auto pb-1 md:order-none md:basis-auto md:flex-1 md:flex-wrap md:overflow-visible md:pb-0">
            {[{ id: 'all', name: t('collection.all'), icon: '', color: '' }, ...factions].map((f) => (
              <button key={f.id} className={`shrink-0 rounded-full border-2 border-[#16181b] px-3 py-0.5 ${tab === f.id ? 'bg-gold' : 'bg-white/85'}`} onClick={() => { setTab(f.id); setSelectedId(null); }}>
                <NamedIcon name={f.icon} /> {f.id === 'all' ? f.name : factionName(f.id, f.name)}
              </button>
            ))}
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3 sm:p-4 md:flex-row md:overflow-hidden">
          <div className="grid w-full flex-none auto-rows-auto grid-cols-2 justify-items-center gap-x-3 gap-y-5 p-2 min-[480px]:grid-cols-3 md:min-h-0 md:flex-1 md:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] md:overflow-y-auto">
            {units.map((u) => {
              const star = player?.stars[u.id] ?? 0;
              const next = nextStar(u, star);
              return (
                <UnitCard
                  key={u.id}
                  unit={u}
                  thumb={thumbs[u.id]}
                  faction={factions.find((f) => f.id === u.factionId)}
                  star={star}
                  locked={!isUnlocked(u, player)}
                  progress={{ have: player?.cards[u.id] ?? 0, need: next?.cards ?? null }}
                  selected={selected?.id === u.id}
                  onClick={() => setSelectedId(u.id)}
                />
              );
            })}
          </div>
          {desktopSelected && (
            <aside className="panel hidden w-full flex-none p-4 md:block md:w-[24rem] md:shrink-0 md:overflow-y-auto">
              {user ? <UnitDetail key={desktopSelected.id} bundle={bundle} unit={desktopSelected} thumb={thumbs[desktopSelected.id]} /> : <GuestDetail unit={desktopSelected} onSignIn={() => openAuth('signin')} />}
            </aside>
          )}
        </div>
      </div>
      {selected && (
        <div className="game-ui fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={`Chi tiết ${selected.name}`}>
          <button className="absolute inset-0 h-full w-full bg-black/60" onClick={() => setSelectedId(null)} aria-label="Đóng chi tiết" />
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-end">
            <div
              className="panel sheet-in pointer-events-auto relative mx-0 flex min-h-0 w-full max-w-full max-h-[85vh] flex-col overflow-hidden rounded-b-none p-4 pt-2"
              style={{ maxHeight: '85dvh' }}
            >
              <div className="relative flex shrink-0 items-center justify-center pb-2">
                <span className="h-1.5 w-12 rounded-full bg-ink/20" />
                <button className="btn absolute right-0 top-0 px-2.5 py-1 text-xl" onClick={() => setSelectedId(null)} aria-label="Đóng">
                  <X />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
                {user ? <UnitDetail key={selected.id} bundle={bundle} unit={selected} thumb={thumbs[selected.id]} /> : <GuestDetail unit={selected} onSignIn={() => openAuth('signin')} />}
              </div>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

function GuestDetail({ unit, onSignIn }: { unit: UnitDef; onSignIn(): void }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-2xl">{unit.name}</h3>
      <p>{unit.unlockCost === 0 ? 'Lính miễn phí: ai cũng dùng được.' : `Mở khóa với ${formatCoins(unit.unlockCost)} coin.`}</p>
      <p>Đăng nhập để nhận hộp quà, sưu tầm thẻ, mở khóa và nâng sao cho lính.</p>
      <button className="btn btn-gold" onClick={onSignIn}>
        <User /> Đăng nhập
      </button>
    </div>
  );
}

function UnitDetail({ bundle, unit, thumb }: { bundle: ConfigBundle; unit: UnitDef; thumb?: string }) {
  const { t, locale, unitName, unitDesc } = useLanguage();
  const ROLE_LABEL: Record<UnitDef['role'], string> = { melee: t('palette.melee'), ranged: t('palette.ranged'), support: t('palette.support'), siege: t('palette.siege') };
  const { player, act } = usePlayer();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const coins = player?.coins ?? 0;
  const star = player?.stars[unit.id] ?? 0;
  const cards = player?.cards[unit.id] ?? 0;
  const unlocked = isUnlocked(unit, player);
  const next = nextStar(unit, star);
  const bonus = bundle.settings.economy.starBonus;
  const power = unitPower(unit, bundle);
  const scale = starScale(star, bonus);
  const nextScale = next ? starScale(next.star, bonus) : scale;

  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(null), 4000);
    return () => window.clearTimeout(t);
  }, [confirm]);

  /** Two taps: the first asks for confirmation, the second sends the request. */
  const run = async (key: string, action: PlayerAction, done: string) => {
    if (confirm !== key) return setConfirm(key);
    setConfirm(null);
    setBusy(true);
    setMessage(null);
    try {
      await act(action);
      setMessage({ ok: true, text: done });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const spendButton = (key: string, label: ReactNode, price: number, action: PlayerAction, done: string, blocked?: string) => (
    <button className={`btn w-full flex-col gap-0 ${confirm === key ? 'btn-red' : 'btn-gold'}`} disabled={busy || !!blocked || coins < price} onClick={() => void run(key, action, done)}>
      <span className="max-w-full break-words text-center">{confirm === key ? `Xác nhận trừ ${formatCoins(price)} coin?` : label}</span>
      <span className="flex items-center gap-1">
        {blocked ??
          (coins < price ? (
            `Thiếu ${formatCoins(price - coins)} coin`
          ) : (
            <>
              <CoinIcon size={20} /> {formatCoins(price)}
            </>
          ))}
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <UnitCard unit={unit} thumb={thumb} faction={bundle.factions.find((f) => f.id === unit.factionId)} star={star} locked={!unlocked} width={112} className="shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="break-words text-2xl leading-tight">{unitName(unit.id, unit.name)}</h3>
          <span className="opacity-75">{ROLE_LABEL[unit.role]}</span>
          <Stars value={star} size={22} />
          <span>
            {locale === 'vi' ? 'Thẻ' : 'Cards'}: <b>{cards}</b>
            {next ? ` / ${next.cards}` : ''}
          </span>
        </div>
      </div>
      {unitDesc(unit.id, unit.description) && <p className="opacity-80">{unitDesc(unit.id, unit.description)}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 rounded-xl bg-white/70 p-2">
        <dt>{t('collection.hp')}</dt>
        <dd className="text-right">
          {Math.round(unit.hp * scale)}
          {next && <span className="text-green-700"> <ArrowRight /> {Math.round(unit.hp * nextScale)}</span>}
        </dd>
        <dt>{t('collection.dps')}</dt>
        <dd className="text-right">
          {Math.round(power.dps * scale)}
          {next && <span className="text-green-700"> <ArrowRight /> {Math.round(power.dps * nextScale)}</span>}
        </dd>
        <dt>{locale === 'vi' ? 'Mỗi sao' : 'Per star'}</dt>
        <dd className="text-right">+{Math.round(bonus * 100)}% {locale === 'vi' ? 'máu, sát thương' : 'HP, damage'}</dd>
      </dl>
      {!unlocked ? (
        spendButton('unlock', <><LockOpen /> {t('collection.unlock')} {unitName(unit.id, unit.name)}</>, unit.unlockCost, { action: 'unlock', unitId: unit.id }, `${unitName(unit.id, unit.name)} ${locale === 'vi' ? 'đã mở khóa!' : 'unlocked!'}`)
      ) : next ? (
        spendButton('upgrade', <><ArrowUp /> {t('collection.upgrade')} {next.star} {t('collection.stars')} ({next.cards} {locale === 'vi' ? 'thẻ' : 'cards'})</>, next.coins, { action: 'upgrade', unitId: unit.id }, `${unitName(unit.id, unit.name)} ${locale === 'vi' ? 'đã lên' : 'reached'} ${next.star} ${t('collection.stars')}!`, cards < next.cards ? `${locale === 'vi' ? 'Cần thêm' : 'Need'} ${next.cards - cards} ${locale === 'vi' ? 'thẻ' : 'cards'}` : undefined)
      ) : (
        <p className="rounded-xl bg-gold/60 p-2 text-center">{locale === 'vi' ? `Đã đạt ${STAR_MAX} sao` : `Max ${STAR_MAX} stars`}</p>
      )}
      {unlocked && unit.cardPrice > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {[10, 50].map((n) => (
            <div key={n}>{spendButton(`buy-${n}`, `${locale === 'vi' ? 'Mua' : 'Buy'} ${n} ${locale === 'vi' ? 'thẻ' : 'cards'}`, unit.cardPrice * n, { action: 'buy-cards', unitId: unit.id, count: n }, `${locale === 'vi' ? 'Đã mua' : 'Bought'} ${n} ${locale === 'vi' ? 'thẻ' : 'cards'} ${unitName(unit.id, unit.name)}`)}</div>
          ))}
        </div>
      )}
      {!unlocked && <p className="opacity-75">{locale === 'vi' ? 'Thẻ rơi từ hộp quà vẫn được cộng dồn; mở khóa để dùng lính trong trận và nâng sao.' : 'Cards from boxes still accumulate; unlock to use this unit in battle and upgrade stars.'}</p>}
      {message && <p className={`rounded-lg px-2 py-1 ${message.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-team'}`}>{message.text}</p>}
    </div>
  );
}
