'use client';

import { useMemo, useState } from 'react';
import type { ConfigBundle, UnitDef } from '@/shared/schema';
import { unitPower } from '@/game/bot/generate';

interface Props {
  bundle: ConfigBundle;
  thumbs: Record<string, string>;
  selected: string | null;
  onSelect(id: string): void;
  budgetLeft: number;
}

const ROLE_LABEL: Record<UnitDef['role'], string> = { melee: 'Cận chiến', ranged: 'Tầm xa', support: 'Hỗ trợ', siege: 'Công thành' };

export default function UnitPalette({ bundle, thumbs, selected, onSelect, budgetLeft }: Props) {
  const factions = useMemo(() => [...bundle.factions].sort((a, b) => a.order - b.order), [bundle]);
  const [tab, setTab] = useState<string>('all');
  const [hover, setHover] = useState<UnitDef | null>(null);
  const units = bundle.units.filter((u) => tab === 'all' || u.factionId === tab).sort((a, b) => a.cost - b.cost);
  const info = hover ?? bundle.units.find((u) => u.id === selected) ?? null;

  return (
    <div className="panel pointer-events-auto flex max-h-[42vh] w-full flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-1">
        <Tab active={tab === 'all'} onClick={() => setTab('all')}>
          Tất cả
        </Tab>
        {factions.map((f) => (
          <Tab key={f.id} active={tab === f.id} onClick={() => setTab(f.id)} color={f.color}>
            {f.icon} {f.name}
          </Tab>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-1.5 overflow-y-auto pr-1">
          {units.map((u) => {
            const faction = bundle.factions.find((f) => f.id === u.factionId);
            const tooExpensive = u.cost > budgetLeft;
            return (
              <button
                key={u.id}
                onClick={() => onSelect(u.id)}
                onMouseEnter={() => setHover(u)}
                onMouseLeave={() => setHover(null)}
                className={`relative flex flex-col items-center rounded-lg border-2 bg-white p-1 text-center transition hover:-translate-y-0.5 ${selected === u.id ? 'border-ink ring-2 ring-gold' : 'border-ink/30'} ${tooExpensive ? 'opacity-45' : ''}`}
                style={{ boxShadow: `inset 0 -4px 0 ${faction?.color ?? '#999'}` }}
              >
                {thumbs[u.id] ? <img src={thumbs[u.id]} alt="" className="h-14 w-14 object-contain" draggable={false} /> : <div className="h-14 w-14 animate-pulse rounded bg-parch" />}
                <span className="line-clamp-1 text-[11px] font-bold leading-tight">{u.name}</span>
                <span className="text-[11px] font-extrabold text-amber-700">{u.cost}</span>
              </button>
            );
          })}
        </div>
        {info && <UnitInfo unit={info} bundle={bundle} />}
      </div>
    </div>
  );
}

function Tab({ active, onClick, children, color }: { active: boolean; onClick(): void; children: React.ReactNode; color?: string }) {
  return (
    <button onClick={onClick} className={`rounded-full border-2 px-3 py-0.5 text-xs font-bold ${active ? 'border-ink bg-ink text-white' : 'border-ink/40 bg-white'}`} style={active && color ? { background: color, borderColor: '#1f1a14' } : undefined}>
      {children}
    </button>
  );
}

function UnitInfo({ unit, bundle }: { unit: UnitDef; bundle: ConfigBundle }) {
  const weapon = bundle.weapons.find((w) => w.id === unit.weaponId);
  const { dps } = unitPower(unit, bundle);
  return (
    <div className="hidden w-52 shrink-0 rounded-lg border-2 border-ink/30 bg-white p-2 text-xs sm:block">
      <div className="font-display text-sm">{unit.name}</div>
      <div className="opacity-70">
        {ROLE_LABEL[unit.role]} · {weapon?.name}
      </div>
      <dl className="mt-1 grid grid-cols-2 gap-x-2">
        <dt>Máu</dt>
        <dd className="text-right font-bold">{unit.hp}</dd>
        <dt>Sát thương/s</dt>
        <dd className="text-right font-bold">{dps.toFixed(0)}</dd>
        <dt>Tầm</dt>
        <dd className="text-right font-bold">{weapon?.range}m</dd>
        <dt>Tốc độ</dt>
        <dd className="text-right font-bold">{unit.speed}</dd>
        <dt>Giáp</dt>
        <dd className="text-right font-bold">{unit.armorClass}</dd>
      </dl>
      {unit.description && <p className="mt-1 italic opacity-80">{unit.description}</p>}
    </div>
  );
}
