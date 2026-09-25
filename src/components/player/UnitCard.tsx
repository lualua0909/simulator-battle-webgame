'use client';

// Arcade portrait card with a purple frame, coin cost and collection progress.
import type { Faction, UnitDef } from '@/shared/schema';
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
  width?: number;
  selected?: boolean;
  onClick?(): void;
  className?: string;
}

export default function UnitCard({ unit, thumb, faction, progress, locked, count, width = 140, selected, onClick, className }: Props) {
  const { locale, unitName } = useLanguage();
  const ready = progress && progress.need !== null && progress.have >= progress.need;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} aria-pressed={onClick ? !!selected : undefined} className={`unit-card ${progress ? 'unit-card-with-progress' : ''} ${ready ? 'unit-card-ready' : ''} ${selected ? 'unit-card-selected' : ''} ${className ?? ''}`} style={{ width, maxWidth: '100%' }}>
      {progress && (
        <div className={`cr-progress ${ready ? 'cr-progress-ready' : ''}`}>
          <div className="cr-progress-fill" style={{ width: `${progress.need === null ? 100 : Math.min(100, (progress.have / Math.max(1, progress.need)) * 100)}%` }} />
          <span className="text-outline relative max-w-full whitespace-nowrap">{progress.need === null ? (locale === 'vi' ? 'TỐI ĐA' : 'MAX') : `${progress.have}/${progress.need}`}</span>
        </div>
      )}
      <UnitCardFace
        name={unitName(unit.id, unit.name)}
        cost={unit.cost}
        thumb={thumb}
        color={faction?.color}
        locked={locked}
        count={count}
      />
    </Tag>
  );
}
