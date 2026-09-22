'use client';

// Unit card in the style of the Clash Royale cards the user referenced: blue striped frame, cost drop,
// portrait, wooden name plank, pennant tail; plus the collection state (stars, cards, lock).
import { useId } from 'react';
import type { Faction, UnitDef } from '@/shared/schema';
import { formatCoins } from '@/shared/economy';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { CoinIcon, LockIcon, Stars } from './icons';

interface Props {
  unit: Pick<UnitDef, 'id' | 'name' | 'cost' | 'unlockCost'>;
  thumb?: string;
  faction?: Pick<Faction, 'color'>;
  /** Star level; hidden when undefined. */
  star?: number;
  /** Cards owned and cards for the next star (null at 5 stars), shown above the card. */
  progress?: { have: number; need: number | null };
  locked?: boolean;
  /** Reward badge (+count). */
  count?: number;
  width?: number;
  selected?: boolean;
  onClick?(): void;
  className?: string;
}

export default function UnitCard({ unit, thumb, faction, star, progress, locked, count, width = 140, selected, onClick, className }: Props) {
  const { locale, unitName } = useLanguage();
  const ready = progress && progress.need !== null && progress.have >= progress.need;
  const Tag = onClick ? 'button' : 'div';
  // useId contains colons that break svg url(#…) references, so strip them.
  const dropId = `cr-drop-${useId().replace(/:/g, '')}`;
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={`cr-card ${selected ? 'cr-card-selected' : ''} ${className ?? ''}`} style={{ width, maxWidth: '100%' }}>
      {progress && (
        <div className={`cr-progress ${ready ? 'cr-progress-ready' : ''}`}>
          <div className="cr-progress-fill" style={{ width: `${progress.need === null ? 100 : Math.min(100, (progress.have / Math.max(1, progress.need)) * 100)}%` }} />
          <span className="text-outline relative">{progress.need === null ? (locale === 'vi' ? 'TỐI ĐA' : 'MAX') : `${progress.have}/${progress.need}`}</span>
        </div>
      )}
      <div className="cr-frame">
        <div className="cr-portrait" style={faction ? { background: `radial-gradient(circle at 50% 32%, #eaf6ff 0%, ${faction.color}88 55%, #24497f 100%)` } : undefined}>
          {thumb ? <img src={thumb} alt="" draggable={false} className={locked ? 'grayscale' : ''} /> : <div className="h-full w-full animate-pulse bg-white/30" />}
          {star !== undefined && !locked && <Stars value={star} size={Math.round(width / 7.5)} className="absolute inset-x-0 bottom-1 justify-center" />}
          {locked && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[#10204080]">
              <LockIcon size={Math.round(width / 4)} />
              <span className="text-outline flex items-center gap-1">
                <CoinIcon size={18} />
                {formatCoins(unit.unlockCost)}
              </span>
            </div>
          )}
          {count !== undefined && <span className="text-outline absolute right-1 top-0 text-2xl">+{count}</span>}
        </div>
        <div className="cr-plank">
          <span className="text-outline">{unitName((unit as { id?: string }).id ?? unit.name, unit.name)}</span>
        </div>
      </div>
      <div className="cr-tail" />
      <div className="cr-cost" title="Giá trong ngân sách trận">
        <svg viewBox="0 0 36 44" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <radialGradient id={dropId} cx="40%" cy="55%" r="65%">
              <stop offset="0%" stopColor="#ffb3f1" />
              <stop offset="55%" stopColor="#d24fc4" />
              <stop offset="100%" stopColor="#7a1f86" />
            </radialGradient>
          </defs>
          <path d="M18 2.5C14 8.5 4.5 18 4.5 27.5a13.5 13.5 0 0 0 27 0C31.5 18 22 8.5 18 2.5z" fill={`url(#${dropId})`} stroke="#3c0a45" strokeWidth="2.4" strokeLinejoin="round" />
          <ellipse cx="13" cy="24" rx="3" ry="5" fill="#ffffff" opacity="0.45" />
        </svg>
        <span className="text-outline relative mt-2">{unit.cost}</span>
      </div>
    </Tag>
  );
}
