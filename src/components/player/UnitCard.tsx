'use client';

// Arcade portrait card with a purple frame, coin cost and collection progress.
import type { Faction, UnitDef } from '@/shared/schema';
import type { ReactNode } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import UnitCardFace from './UnitCardFace';

interface Props {
  unit: Pick<UnitDef, 'id' | 'name' | 'cost' | 'unlockCost'> & Partial<Pick<UnitDef, 'role'>>;
  thumb?: string;
  faction?: Pick<Faction, 'color'>;
  /** Star level; hidden when undefined. */
  star?: number;
  /** Cards owned and cards for the next star (null at 5 stars), shown above the card. */
  progress?: { have: number; need: number | null };
  locked?: boolean;
  /** Reward badge (+count). */
  count?: number;
  width?: number | string;
  selected?: boolean;
  onClick?(): void;
  className?: string;
  /** Optional detail-card back face. When provided, clicking flips the card. */
  back?: ReactNode;
  flipped?: boolean;
  onFlip?(): void;
  artwork?: ReactNode;
}

export default function UnitCard({ unit, thumb, faction, star, progress, locked, count, width = 140, selected, onClick, className, back, flipped, onFlip, artwork }: Props) {
  const { locale, unitName } = useLanguage();
  const ready = progress && progress.need !== null && progress.have >= progress.need;
  const handleClick = onFlip ?? onClick;
  const Tag = handleClick ? 'button' : 'div';
  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!back) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    event.currentTarget.style.setProperty('--pointer-x', `${x}%`);
    event.currentTarget.style.setProperty('--pointer-y', `${y}%`);
    event.currentTarget.style.setProperty('--rotate-y', `${(x - 50) * 0.14}deg`);
    event.currentTarget.style.setProperty('--rotate-x', `${(50 - y) * 0.1}deg`);
  };
  const handlePointerLeave = (event: React.PointerEvent<HTMLElement>) => {
    if (!back) return;
    event.currentTarget.style.setProperty('--pointer-x', '50%');
    event.currentTarget.style.setProperty('--pointer-y', '50%');
    event.currentTarget.style.setProperty('--rotate-y', '0deg');
    event.currentTarget.style.setProperty('--rotate-x', '0deg');
  };
  return (
    <Tag type={handleClick ? 'button' : undefined} onClick={handleClick} onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave} aria-pressed={onClick ? !!selected : undefined} className={`unit-card ${progress ? 'unit-card-with-progress' : ''} ${selected ? 'unit-card-selected' : ''} ${back ? 'unit-card-flippable' : ''} ${flipped ? 'unit-card-flipped' : ''} ${className ?? ''}`} style={{ width, maxWidth: '100%' }}>
      {progress && (
        <div className={`cr-progress ${ready ? 'cr-progress-ready' : ''}`}>
          <div className="cr-progress-fill" style={{ width: `${progress.need === null ? 100 : Math.min(100, (progress.have / Math.max(1, progress.need)) * 100)}%` }} />
          <span className="text-outline relative max-w-full whitespace-nowrap">{progress.need === null ? (locale === 'vi' ? 'TỐI ĐA' : 'MAX') : `${progress.have}/${progress.need}`}</span>
        </div>
      )}
      <span className="unit-card-inner">
        <span className="unit-card-side unit-card-front">
          <UnitCardFace name={unitName(unit.id, unit.name)} cost={unit.cost} thumb={thumb} color={faction?.color} locked={locked} star={star} count={count} artwork={artwork} />
        </span>
        {back && <span className="unit-card-side unit-card-back">{back}</span>}
      </span>
    </Tag>
  );
}
