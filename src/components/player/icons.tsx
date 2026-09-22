// Small SVG icons of the game UI (drawn, not emoji).

export function CoinIcon({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 40 42" width={size} height={size * 1.05} className={className} aria-hidden>
      <ellipse cx="20" cy="23" rx="17.5" ry="17.5" fill="#94600a" />
      <circle cx="20" cy="20" r="17.5" fill="#f3b31d" stroke="#6f4504" strokeWidth="2.2" />
      <circle cx="20" cy="20" r="11.5" fill="#ffd84a" stroke="#d18d0f" strokeWidth="2.2" />
      <path d="M11.5 14.5 A 10.5 10.5 0 0 1 19 9.6" stroke="#fff7c8" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const STAR = 'M12 1.8l3.1 6.5 7.1.9-5.2 4.9 1.3 7-6.3-3.4-6.3 3.4 1.3-7-5.2-4.9 7.1-.9z';

export function StarIcon({ size = 18, filled = true, className }: { size?: number; filled?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden>
      <path d={STAR} fill={filled ? '#ffd23f' : 'rgba(20,24,36,0.55)'} stroke={filled ? '#7a4a00' : 'rgba(255,255,255,0.45)'} strokeWidth="1.8" strokeLinejoin="round" />
      {filled && <path d="M8.2 9.6l2.4-.4 1.1-2.3" stroke="#fff6c4" strokeWidth="1.4" strokeLinecap="round" fill="none" />}
    </svg>
  );
}

/** Row of `max` stars with the first `value` filled. */
export function Stars({ value, max = 5, size = 18, className }: { value: number; max?: number; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center ${className ?? ''}`} aria-label={`${value}/${max} sao`}>
      {Array.from({ length: max }, (_, i) => (
        <StarIcon key={i} size={size} filled={i < value} className={i ? '-ml-0.5' : ''} />
      ))}
    </span>
  );
}

export function LockIcon({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden>
      <path d="M7 10V7.5a5 5 0 0 1 10 0V10" fill="none" stroke="#2d3232" strokeWidth="3.6" />
      <path d="M7 10V7.5a5 5 0 0 1 10 0V10" fill="none" stroke="#c9d1da" strokeWidth="1.8" />
      <rect x="4" y="9.5" width="16" height="12.5" rx="2.5" fill="#f2b41d" stroke="#2d3232" strokeWidth="1.8" />
      <rect x="10.8" y="13.2" width="2.4" height="5" rx="1.2" fill="#2d3232" />
    </svg>
  );
}
