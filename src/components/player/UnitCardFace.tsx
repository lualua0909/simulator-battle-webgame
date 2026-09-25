import type { CSSProperties } from 'react';
import { CoinIcon, LockIcon } from './icons';

interface Props {
  name: string;
  cost: number;
  thumb?: string;
  color?: string;
  locked?: boolean;
  count?: number;
}

/** Shared card artwork; its parent owns selection, clicking and drag behavior. */
export default function UnitCardFace({ name, cost, thumb, color = '#4384f5', locked, count }: Props) {
  return (
    <span className="unit-card-frame" style={{ '--portrait-color': color } as CSSProperties}>
      <span className="unit-card-header">
        <span className="unit-card-level"><CoinIcon size={24} /></span>
        <span className="unit-card-price" title={`${cost}`}>
          <span>{cost}</span>
        </span>
      </span>
      <span className={`unit-card-portrait ${locked ? 'unit-card-locked' : ''}`}>
        {thumb ? <img src={thumb} alt="" draggable={false} /> : <span className="unit-card-placeholder" />}
        {locked && <span className="unit-card-lock"><LockIcon size={28} /></span>}
        {count !== undefined && <span className="unit-card-count">+{count}</span>}
      </span>
      <span className="unit-card-footer" title={name}>{name}</span>
    </span>
  );
}
