'use client';

import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isUnlocked, starScale, type PlayerState } from '@/shared/economy';
import type { ConfigBundle, UnitDef } from '@/shared/schema';
import { unitPower } from '@/game/bot/generate';
import { LockIcon, StarIcon } from '@/components/player/icons';
import { NamedIcon } from '@/components/ui/NamedIcon';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface Props {
  bundle: ConfigBundle;
  thumbs: Record<string, string>;
  selected: string | null;
  onSelect(id: string): void;
  /** Pointer went down on a card: begin dragging that unit onto the map (picks it immediately, ignoring whatever was selected before). */
  onDragStart?(id: string, e: React.PointerEvent<HTMLButtonElement>): void;
  /** The unit currently being dragged, if any — dims its source card. */
  draggingId?: string | null;
  budgetLeft: number;
  /** The player's wallet (null for guests): locked units stay visible but greyed out. */
  player: PlayerState | null;
  /** Star levels shown on the tiles when they count in this battle. */
  stars?: Record<string, number>;
  /** Units usable in this mode and side (others are hidden). */
  available?: (u: UnitDef) => boolean;
  /** Control shown at the right end of the tab row. */
  action?: React.ReactNode;
}

export default function UnitPalette({ bundle, thumbs, selected, onSelect, onDragStart, draggingId, budgetLeft, player, stars, available, action }: Props) {
  const { t, factionName, unitName } = useLanguage();
  const ROLE_LABEL: Record<UnitDef['role'], string> = { melee: t('palette.melee'), ranged: t('palette.ranged'), support: t('palette.support'), siege: t('palette.siege') };
  const [tab, setTab] = useState<string>('all');
  const [hover, setHover] = useState<UnitDef | null>(null);
  const pool = bundle.units.filter((u) => !available || available(u));
  const factions = useMemo(() => [...bundle.factions].sort((a, b) => a.order - b.order), [bundle]).filter((f) => pool.some((u) => u.factionId === f.id));
  const units = pool.filter((u) => tab === 'all' || u.factionId === tab).sort((a, b) => Number(isUnlocked(b, player)) - Number(isUnlocked(a, player)) || a.cost - b.cost);
  const info = hover ?? bundle.units.find((u) => u.id === selected) ?? null;

  return (
    // Fixed height: a faction tab with few units must not shrink the tray and shift the map framed above it.
    <div className="panel pointer-events-auto flex h-[32dvh] min-h-[150px] w-full min-w-0 flex-col gap-1.5 overflow-hidden overscroll-contain p-1.5 sm:h-[42vh] sm:gap-2 sm:p-2 landscape:h-[48dvh] landscape:min-h-[120px]">
      <div className="flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto overscroll-contain py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Tab active={tab === 'all'} onClick={() => setTab('all')}>
          {t('palette.all')}
        </Tab>
        {factions.map((f) => (
          <Tab key={f.id} active={tab === f.id} onClick={() => setTab(f.id)} color={f.color} label={factionName(f.id, f.name)}>
            <NamedIcon name={f.icon} /> <span className="hidden min-[420px]:inline">{factionName(f.id, f.name)}</span>
          </Tab>
        ))}
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(84px,1fr))] content-start gap-1 overflow-y-auto overscroll-contain px-0.5 pb-0.5 pt-1 sm:grid-cols-[repeat(auto-fill,minmax(108px,1fr))] sm:gap-1.5">
          {units.map((u) => {
            const faction = bundle.factions.find((f) => f.id === u.factionId);
            const locked = !isUnlocked(u, player);
            const tooExpensive = u.cost > budgetLeft;
            const star = stars?.[u.id] ?? 0;
            return (
              <button
                key={u.id}
                onClick={() => onSelect(u.id)}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  onDragStart?.(u.id, e);
                }}
                onMouseEnter={() => setHover(u)}
                onMouseLeave={() => setHover(null)}
                className={`relative flex min-w-0 touch-pan-y flex-col items-center rounded-lg border-2 bg-white p-1 text-center transition hover:-translate-y-0.5 sm:touch-none ${selected === u.id ? 'border-ink ring-2 ring-gold' : 'border-ink/30'} ${tooExpensive || locked ? 'opacity-50' : ''} ${draggingId === u.id ? 'opacity-40' : ''}`}
                style={{ boxShadow: `inset 0 -4px 0 ${faction?.color ?? '#999'}` }}
                title={`${unitName(u.id, u.name)} · ${u.cost}`}
              >
                {thumbs[u.id] ? <img src={thumbs[u.id]} alt="" className={`h-10 w-10 object-contain sm:h-14 sm:w-14 ${locked ? 'grayscale' : ''}`} draggable={false} /> : <div className="h-10 w-10 animate-pulse rounded bg-parch sm:h-14 sm:w-14" />}
                {locked && <LockIcon size={24} className="absolute right-1 top-1" />}
                {star > 0 && (
                  <span className="absolute left-1 top-0.5 flex items-center leading-none">
                    <StarIcon size={18} />
                  </span>
                )}
                <span className="line-clamp-2 flex min-h-[2em] w-full items-start justify-center break-words text-xs leading-tight sm:text-[13px]">{unitName(u.id, u.name)}</span>
                <span className="text-sm font-bold text-amber-700">{u.cost}</span>
              </button>
            );
          })}
        </div>
        {info && <UnitInfo unit={info} bundle={bundle} star={stars?.[info.id] ?? 0} />}
      </div>
      {info && (
        <div className="shrink-0 truncate border-t-2 border-ink/10 px-1 pt-1 text-xs sm:hidden" title={`${unitName(info.id, info.name)} · HP ${Math.round(info.hp * starScale(stars?.[info.id] ?? 0, bundle.settings.economy.starBonus))} · ${info.cost}`}>
          <b>{unitName(info.id, info.name)}</b> · HP {Math.round(info.hp * starScale(stars?.[info.id] ?? 0, bundle.settings.economy.starBonus))} · {info.cost} · {ROLE_LABEL[info.role]}
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, children, color, label }: { active: boolean; onClick(): void; children: React.ReactNode; color?: string; label?: string }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-full border-2 px-2 py-0.5 text-xs font-bold sm:px-3 ${active ? 'border-ink bg-ink text-white' : 'border-ink/40 bg-white'}`} style={active && color ? { background: color, borderColor: '#1f1a14' } : undefined}>
      {children}
    </button>
  );
}

function UnitInfo({ unit, bundle, star }: { unit: UnitDef; bundle: ConfigBundle; star: number }) {
  const { t, locale, unitName, unitDesc, weaponName } = useLanguage();
  const ROLE_LABEL: Record<UnitDef['role'], string> = { melee: t('palette.melee'), ranged: t('palette.ranged'), support: t('palette.support'), siege: t('palette.siege') };
  const ARMOR_LABEL: Record<string, string> =
    locale === 'vi'
      ? { unarmored: 'Không giáp', light: 'Nhẹ', heavy: 'Nặng', beast: 'Quái thú', siege: 'Công thành' }
      : { unarmored: 'Unarmored', light: 'Light', heavy: 'Heavy', beast: 'Beast', siege: 'Siege' };
  const weapon = bundle.weapons.find((w) => w.id === unit.weaponId);
  const skills = unit.skillIds.map((id) => bundle.weapons.find((w) => w.id === id)).filter((w) => !!w);
  const { dps } = unitPower(unit, bundle);
  const scale = starScale(star, bundle.settings.economy.starBonus);
  return (
    <div className="hidden w-64 shrink-0 overflow-y-auto break-words rounded-lg border-2 border-ink/30 bg-white p-2 text-sm md:block">
      <div className="font-display text-sm">
        {unitName(unit.id, unit.name)}
        {star > 0 && <span className="text-amber-700"> · {star} {locale === 'vi' ? 'sao' : star > 1 ? 'stars' : 'star'}</span>}
      </div>
      <div className="opacity-70">
        {ROLE_LABEL[unit.role]} · {weapon ? weaponName(weapon.id, weapon.name) : ''}
      </div>
      <dl className="mt-1 grid grid-cols-2 gap-x-2">
        <dt>{t('collection.hp')}</dt>
        <dd className="text-right font-bold">{Math.round(unit.hp * scale)}</dd>
        <dt>{locale === 'vi' ? 'Sát thương/s' : 'DPS'}</dt>
        <dd className="text-right font-bold">{(dps * scale).toFixed(0)}</dd>
        <dt>{locale === 'vi' ? 'Tầm' : 'Range'}</dt>
        <dd className="text-right font-bold">{weapon?.range}m</dd>
        <dt>{locale === 'vi' ? 'Tốc độ' : 'Speed'}</dt>
        <dd className="text-right font-bold">{unit.speed}</dd>
        {unit.attackSpeed !== 1 && (
          <>
            <dt>{locale === 'vi' ? 'Tốc độ đánh' : 'Attack speed'}</dt>
            <dd className="text-right font-bold">×{unit.attackSpeed}</dd>
          </>
        )}
        <dt>{locale === 'vi' ? 'Giáp' : 'Armor'}</dt>
        <dd className="text-right font-bold">{ARMOR_LABEL[unit.armorClass] ?? unit.armorClass}</dd>
      </dl>
      {skills.length > 0 && (
        <p className="mt-1">
          <b><Sparkles /> {locale === 'vi' ? 'Kỹ năng:' : 'Skills:'}</b> {skills.map((w) => weaponName(w.id, w.name)).join(', ')}
          {unit.castSpeed !== 1 && <span className="opacity-70"> ({locale === 'vi' ? 'tốc độ' : 'speed'} ×{unit.castSpeed})</span>}
        </p>
      )}
      {unitDesc(unit.id, unit.description) && <p className="mt-1 italic opacity-80">{unitDesc(unit.id, unit.description)}</p>}
    </div>
  );
}
