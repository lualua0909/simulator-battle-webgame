'use client';

// Box opening via the Rive prize-reveal modal (box_prize_reveal_modal_v25.riv): claims the box on
// the server as soon as it mounts, then hands the rolled reward to RiveBoxReveal. `tier` (6…10)
// picks the chest rarity inside the file (its `tierNum` key).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoxReward, PlayerAction } from '@/shared/economy';
import type { ConfigBundle } from '@/shared/schema';
import { usePlayer } from './PlayerProvider';
import RiveBoxReveal from './RiveBoxReveal';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface Props {
  bundle: ConfigBundle;
  action: PlayerAction;
  title: string;
  /** Rive `tierNum`: 6 (base) … 10 (rarest). */
  tier: number;
  thumbs: Record<string, string>;
  onClose(): void;
}

export default function BoxOpening({ bundle, action, title, tier, thumbs, onClose }: Props) {
  const { locale } = useLanguage();
  const { act } = usePlayer();
  const [reward, setReward] = useState<BoxReward | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Once per mount (StrictMode re-runs effects): a second claim would be refused or double-spend.
    if (started.current) return;
    started.current = true;
    act(action)
      .then((res) => (res.reward ? setReward(res.reward) : setError(locale === 'vi' ? 'Không mở được hộp' : 'Could not open the box')))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reward) return <RiveBoxReveal bundle={bundle} thumbs={thumbs} tier={tier} reward={reward} label={title} onClose={onClose} />;

  return createPortal(
    <div className="game-ui fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/60 px-4" role="dialog" aria-label={title}>
      {error ? (
        <>
          <p className="rounded-lg bg-white/90 px-3 py-1 text-red-team">{error}</p>
          <button className="btn btn-gold px-8 py-2 text-xl" onClick={onClose}>
            {locale === 'vi' ? 'Đóng' : 'Close'}
          </button>
        </>
      ) : (
        <span className="text-outline animate-pulse text-xl">…</span>
      )}
    </div>,
    document.body,
  );
}
