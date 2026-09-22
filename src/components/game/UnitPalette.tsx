'use client';

import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isUnlocked, starScale, type PlayerState } from '@/shared/economy';
import type { ConfigBundle, UnitDef } from '@/shared/schema';
import { unitPower } from '@/game/bot/generate';
import { LockIcon, StarIcon } from '@/components/player/icons';
import { NamedIcon } from '@/components/ui/NamedIcon';

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
}

const ROLE_LABEL: Record<UnitDef['role'], string> = { melee: 'Cận chiến', ranged: 'Tầm xa', support: 'Hỗ trợ', siege: 'Công thành' };

export default function UnitPalette({ bundle, thumbs, selected, onSelect, onDragStart, draggingId, budgetLeft, player, stars, available }: Props) {
  const [tab, setTab] = useState<string>('all');
  const [hover, setHover] = useState<UnitDef | null>(null);
  const pool = bundle.units.filter((u) => !available || available(u));
  const factions = useMemo(() => [...bundle.factions].sort((a, b) => a.order - b.order), [bundle]).filter((f) => pool.some((u) => u.factionId === f.id));
  const units = pool.filter((u) => tab === 'all' || u.factionId === tab).sort((a, b) => Number(isUnlocked(b, player)) - Number(isUnlocked(a, player)) || a.cost - b.cost);
  const info = hover ?? bundle.units.find((u) => u.id === selected) ?? null;

  return (
    <div className="panel pointer-events-auto flex max-h-[32vh] w-full min-h-0 flex-col gap-1.5 overflow-hidden overscroll-contain p-1.5 sm:max-h-[42vh] sm:gap-2 sm:p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1 overflow-x-auto overscroll-contain py-0.5">
        <Tab active={tab === 'all'} onClick={() => setTab('all')}>
          Tất cả
        </Tab>
        {factions.map((f) => (
          <Tab key={f.id} active={tab === f.id} onClick={() => setTab(f.id)} color={f.color}>
            <NamedIcon name={f.icon} /> <span className="hidden sm:inline">{f.name}</span>
          </Tab>
        ))}
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
                title={`${u.name} · ${u.cost}`}
              >
                {thumbs[u.id] ? <img src={thumbs[u.id]} alt="" className={`h-10 w-10 object-contain sm:h-14 sm:w-14 ${locked ? 'grayscale' : ''}`} draggable={false} /> : <div className="h-10 w-10 animate-pulse rounded bg-parch sm:h-14 sm:w-14" />}
                {locked && <LockIcon size={24} className="absolute right-1 top-1" />}
                {star > 0 && (
                  <span className="absolute left-1 top-0.5 flex items-center leading-none">
                    <StarIcon size={18} />
                  </span>
                )}
                <span className="line-clamp-2 flex min-h-[2.2em] w-full items-start justify-center break-words text-[12px] leading-tight sm:text-[13px]">{u.name}</span>
                <span className="text-[13px] font-bold text-amber-700 sm:text-sm">{u.cost}</span>
              </button>
            );
          })}
        </div>
        {info && <UnitInfo unit={info} bundle={bundle} star={stars?.[info.id] ?? 0} />}
      </div>
    </div>
  );
}

function Tab({ active, onClick, children, color }: { active: boolean; onClick(): void; children: React.ReactNode; color?: string }) {
  return (
    <button onClick={onClick} className={`whitespace-nowrap rounded-full border-2 px-2 py-0.5 text-[11px] font-bold sm:px-3 sm:text-xs ${active ? 'border-ink bg-ink text-white' : 'border-ink/40 bg-white'}`} style={active && color ? { background: color, borderColor: '#1f1a14' } : undefined}>
      {children}
    </button>
  );
}

function UnitInfo({ unit, bundle, star }: { unit: UnitDef; bundle: ConfigBundle; star: number }) {
  const ARMOR_LABEL: Record<string, string> = { unarmored: 'Không giáp', light: 'Nhẹ', heavy: 'Nặng', beast: 'Quái thú', siege: 'Công thành' };
  const weapon = bundle.weapons.find((w) => w.id === unit.weaponId);
  const skills = unit.skillIds.map((id) => bundle.weapons.find((w) => w.id === id)).filter((w) => !!w);
  const { dps } = unitPower(unit, bundle);
  const scale = starScale(star, bundle.settings.economy.starBonus);
  return (
    <div className="hidden w-64 shrink-0 overflow-y-auto break-words rounded-lg border-2 border-ink/30 bg-white p-2 text-xs sm:block">
      <div className="font-display text-sm">
        {unit.name}
        {star > 0 && <span className="text-amber-700"> · {star} sao</span>}
      </div>
      <div className="opacity-70">
        {ROLE_LABEL[unit.role]} · {weapon?.name}
      </div>
      <dl className="mt-1 grid grid-cols-2 gap-x-2">
        <dt>Máu</dt>
        <dd className="text-right font-bold">{Math.round(unit.hp * scale)}</dd>
        <dt>Sát thương/s</dt>
        <dd className="text-right font-bold">{(dps * scale).toFixed(0)}</dd>
        <dt>Tầm</dt>
        <dd className="text-right font-bold">{weapon?.range}m</dd>
        <dt>Tốc độ</dt>
        <dd className="text-right font-bold">{unit.speed}</dd>
        {unit.attackSpeed !== 1 && (
          <>
            <dt>Tốc độ đánh</dt>
            <dd className="text-right font-bold">×{unit.attackSpeed}</dd>
          </>
        )}
        <dt>Giáp</dt>
        <dd className="text-right font-bold">{ARMOR_LABEL[unit.armorClass] ?? unit.armorClass}</dd>
      </dl>
      {skills.length > 0 && (
        <p className="mt-1">
          <b><Sparkles /> Kỹ năng:</b> {skills.map((w) => w.name).join(', ')}
          {unit.castSpeed !== 1 && <span className="opacity-70"> (tốc độ ×{unit.castSpeed})</span>}
        </p>
      )}
      {unit.description && <p className="mt-1 italic opacity-80">{unit.description}</p>}
    </div>
  );
}
