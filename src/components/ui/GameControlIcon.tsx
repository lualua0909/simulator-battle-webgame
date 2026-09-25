import type { ReactNode } from 'react';

export type GameControl = 'overview' | 'side' | 'third' | 'first' | 'second' | 'next' | 'vr' | 'sound' | 'muted' | 'play' | 'pause' | 'stop' | 'help';

/** Solid arcade symbols: white faces, dark outlines, readable at button size. */
export default function GameControlIcon({ name }: { name: GameControl }) {
  const shapes: Record<GameControl, ReactNode> = {
    overview: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z" /><path d="M9 3v15M15 6v15" fill="none" /></>,
    side: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16M3 9h18" fill="none" /></>,
    third: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-3a8 8 0 0 1 16 0v3Z" /></>,
    first: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3.5" fill="#292130" stroke="none" /></>,
    second: <><circle cx="12" cy="4" r="2.5" /><path d="m9 8-6-2-1 3 7 3-3 9 3 1 3-7 3 7 3-1-3-9 7-3-1-3-6 2Z" /></>,
    next: <><path d="m3 4 12 8L3 20Z" /><rect x="17" y="4" width="4" height="16" rx="1" /></>,
    vr: <><path d="M5 6h14l3 5v8h-7l-3-4-3 4H2v-8Z" /><path d="M6 9h3v5H6ZM15 9h3v5h-3Z" fill="#292130" stroke="none" /></>,
    sound: <><path d="M3 9h4l6-5v16l-6-5H3Z" /><path d="M17 8q4 4 0 8M20 4q7 8 0 16" fill="none" stroke="#292130" strokeWidth="4" /><path d="M17 8q4 4 0 8M20 4q7 8 0 16" fill="none" stroke="white" strokeWidth="2" /></>,
    muted: <><path d="M3 9h4l6-5v16l-6-5H3Z" /><path d="m17 9 5 6m0-6-5 6" fill="none" strokeWidth="4" /><path d="m17 9 5 6m0-6-5 6" fill="none" stroke="white" strokeWidth="2" /></>,
    play: <path d="M6 3 22 12 6 21Z" />,
    pause: <><rect x="4" y="3" width="6" height="18" rx="1" /><rect x="14" y="3" width="6" height="18" rx="1" /></>,
    stop: <rect x="4" y="4" width="16" height="16" rx="2" />,
    help: <><path d="M6 8c0-8 14-8 14 0 0 5-6 5-6 9h-5c0-7 6-6 6-9 0-3-4-3-4 0Z" /><circle cx="11.5" cy="21" r="2" /></>,
  };
  return <svg className="game-control-icon" viewBox="0 0 26 26" aria-hidden="true" fill="#fff" stroke="#292130" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">{shapes[name]}</svg>;
}
