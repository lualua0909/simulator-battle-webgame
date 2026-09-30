import type { CSSProperties } from 'react';
import type { ReactNode } from 'react';
import { CoinIcon, LockIcon, Stars } from './icons';

interface Props {
  name: string;
  cost: number;
  thumb?: string;
  color?: string;
  locked?: boolean;
  /** Star level shown in the portrait's top-right corner; hidden when undefined or locked. */
  star?: number;
  count?: number;
  artwork?: ReactNode;
}

/** Shared card artwork; its parent owns selection, clicking and drag behavior. */
export default function UnitCardFace({ name, cost, thumb, color = '#4384f5', locked, star, count, artwork }: Props) {
  return (
    <span className="unit-card-frame" style={{ '--portrait-color': color } as CSSProperties}>
      <span className="unit-card-header">
        <span className="unit-card-level"><CoinIcon size={24} /></span>
        <span className="unit-card-price" title={`${cost}`}>
          <span>{cost}</span>
        </span>
      </span>
      <span className={`unit-card-portrait ${locked ? 'unit-card-locked' : ''}`}>
        {artwork ?? (thumb ? <img src={thumb} alt="" draggable={false} /> : <span className="unit-card-placeholder" />)}
        {star !== undefined && !locked && <Stars value={star} size={14} className="unit-card-stars" />}
        {locked && <span className="unit-card-lock"><LockIcon size={28} /></span>}
        {count !== undefined && <span className="unit-card-count">+{count}</span>}
      </span>
      <span className="unit-card-footer" title={name} style={Math.max(...name.split(/\s+/).map((w) => w.length)) > 12 ? { fontSize: 11 } : undefined}>{name}</span>
    </span>
  );
}
