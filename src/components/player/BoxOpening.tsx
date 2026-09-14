'use client';

// Full-screen box opening: the chest hops while waiting for a tap, rattles while the server rolls
// the rewards, bursts open, then the coins and unit cards pop out one by one.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoxKind, BoxReward } from '@/shared/economy';
import { formatCoins } from '@/shared/economy';
import type { ChestVariant, ConfigBundle } from '@/shared/schema';
import ChestStage, { type ChestMode } from './ChestStage';
import { CoinIcon } from './icons';
import { CoinBar } from './PlayerHud';
import { usePlayer } from './PlayerProvider';
import UnitCard from './UnitCard';

interface Props {
  bundle: ConfigBundle;
  kind: BoxKind;
  title: string;
  chest: ChestVariant;
  thumbs: Record<string, string>;
  onClose(): void;
}

export default function BoxOpening({ bundle, kind, title, chest, thumbs, onClose }: Props) {
  const { player, act } = usePlayer();
  const [mode, setMode] = useState<ChestMode>('idle');
  const [reward, setReward] = useState<BoxReward | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && mode !== 'shake' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, onClose]);

  const open = async () => {
    if (mode !== 'idle') return;
    setError(null);
    setMode('shake');
    // Let the rattle read even when the server answers instantly.
    const [result] = await Promise.allSettled([act({ action: 'open-box', kind }), new Promise((r) => setTimeout(r, 700))]);
    if (result.status === 'fulfilled' && result.value.reward) {
      setReward(result.value.reward);
      setMode('open');
    } else {
      setError(result.status === 'rejected' ? (result.reason as Error).message : 'Không mở được hộp');
      setMode('idle');
    }
  };

  const units = new Map(bundle.units.map((u) => [u.id, u]));
  const factions = new Map(bundle.factions.map((f) => [f.id, f]));

  return createPortal(
    <div className="game-ui box-backdrop fixed inset-0 z-50 flex flex-col items-center overflow-y-auto px-4 pb-6 pt-4">
      <div className="absolute right-7 top-3">
        <CoinBar value={player?.coins ?? 0} />
      </div>
      <h2 className="text-outline mt-14 text-center text-4xl sm:mt-2">{title}</h2>
      <div className={`relative w-full max-w-xl shrink-0 ${revealed ? 'h-[32vh]' : 'h-[56vh]'} transition-[height] duration-500`}>
        <ChestStage variant={chest} mode={mode} onOpened={() => setRevealed(true)} />
        {mode === 'idle' && <button className="absolute inset-0 cursor-pointer" aria-label="Mở hộp" onClick={() => void open()} />}
      </div>
      {mode === 'idle' && (
        <div className="flex flex-col items-center gap-3">
          <button className="btn btn-gold animate-bounce px-8 py-3 text-2xl" onClick={() => void open()}>
            Chạm để mở!
          </button>
          {error && <p className="rounded-lg bg-white/90 px-3 py-1 text-red-team">{error}</p>}
          <button className="text-outline underline" onClick={onClose}>
            Để sau
          </button>
        </div>
      )}
      {mode === 'shake' && <p className="text-outline text-2xl">Đang mở…</p>}
      {revealed && reward && (
        <div className="flex w-full max-w-4xl flex-col items-center gap-4">
          <div className="reward-pop flex items-center gap-2 rounded-2xl border-2 border-[#16181b] bg-[#1d2f55cc] px-5 py-2" style={{ animationDelay: '0ms' }}>
            <CoinIcon size={40} />
            <span className="text-outline text-3xl">+{formatCoins(reward.coins)}</span>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {reward.cards.map((c, i) => {
              const unit = units.get(c.unitId);
              if (!unit) return null;
              const star = player?.stars[c.unitId] ?? 0;
              return (
                <div key={c.unitId} className="reward-pop" style={{ animationDelay: `${200 + i * 220}ms` }}>
                  <UnitCard unit={unit} thumb={thumbs[c.unitId]} faction={factions.get(unit.factionId)} count={c.count} star={star} width={132} progress={{ have: player?.cards[c.unitId] ?? c.count, need: unit.starCards[star] ?? null }} />
                </div>
              );
            })}
          </div>
          <button className="btn btn-gold px-10 py-3 text-2xl" onClick={onClose}>
            Nhận
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
