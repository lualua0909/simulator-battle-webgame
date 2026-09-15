'use client';

// Top nav bar: coin bar, card collection, the reward slot (today's box — daily calendar first,
// then the x-hour box once the daily box is claimed) and the avatar/account menu. `bundle` is
// optional: pass the caller's own already-loaded bundle (GameClient) to skip a redundant
// /api/config fetch, or omit it (the home page) to have this component load its own.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { formatCoins, liveBoxes, type BoxKind } from '@/shared/economy';
import type { ChestVariant, ConfigBundle } from '@/shared/schema';
import { canAccessCms } from '@/shared/users';
import { useAuth } from '@/components/auth/AuthProvider';
import { chestThumbnail } from '@/game/render/chestThumbnails';
import { unitThumbnails } from '@/game/render/thumbnails';
import { useConfig } from '@/game/useConfig';
import BoxOpening from './BoxOpening';
import Collection from './Collection';
import { CoinIcon } from './icons';
import PlayerAvatar from './PlayerAvatar';
import { usePlayer, useTick } from './PlayerProvider';
import WeeklyReward from './WeeklyReward';

export function CoinBar({ value, loading }: { value: number; loading?: boolean }) {
  return (
    <div className="coin-bar" title="Coin (1 coin = 1 VNĐ)">
      <span className="text-outline ml-auto text-xl leading-none tabular-nums">{loading ? '…' : formatCoins(value)}</span>
      <CoinIcon size={42} className="absolute -right-4 top-1/2 -translate-y-1/2 drop-shadow" />
    </div>
  );
}

export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function ChestThumb({ variant, wobble, size = 72 }: { variant: ChestVariant; wobble: boolean; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void chestThumbnail(variant).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [variant]);
  return (
    <div style={{ height: size, width: size }} className="shrink-0">
      {src && <img src={src} alt="" draggable={false} className={`h-full w-full scale-125 object-contain ${wobble ? 'chest-wobble' : ''}`} />}
    </div>
  );
}

export default function PlayerHud({ bundle: externalBundle }: { bundle?: ConfigBundle | null } = {}) {
  const { user, loading, openAuth, signOut } = useAuth();
  const { player, boxes, now, loading: walletLoading, error } = usePlayer();
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState<BoxKind | null>(null);
  const [collection, setCollection] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  // undefined (home page: no prop passed) = load our own; a value (GameClient's own bundle,
  // already loaded there) = use it and skip our own fetch entirely.
  const external = externalBundle !== undefined;
  const selfConfig = useConfig(!external);
  const bundle = external ? externalBundle : selfConfig.bundle;
  useTick(1000);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  useEffect(() => {
    if (bundle && (opening || collection || weekly)) void unitThumbnails(bundle).then(setThumbs);
  }, [bundle, opening, collection, weekly]);

  if (loading) return <div className="coin-bar opacity-60" />;

  if (!user) {
    return (
      <div className="pointer-events-auto flex items-center gap-2">
        <button className="reward-slot" onClick={() => setCollection(true)} title="Bộ sưu tập thẻ" aria-label="Bộ sưu tập thẻ">
          <span className="text-2xl">🃏</span>
        </button>
        <button className="btn btn-gold" onClick={() => openAuth('signin')}>
          👤 Đăng nhập
        </button>
        {bundle && collection && <Collection bundle={bundle} thumbs={thumbs} onClose={() => setCollection(false)} />}
      </div>
    );
  }

  const name = user.displayName || user.email?.split('@')[0] || 'Tướng quân';
  const status = boxes ? liveBoxes(boxes, now()) : null;
  const economy = bundle?.settings.economy;

  return (
    <div ref={box} className="pointer-events-auto relative flex items-center gap-3">
      <div className="mr-4">
        <CoinBar value={player?.coins ?? 0} loading={walletLoading && !player} />
      </div>
      <button className="reward-slot" onClick={() => setCollection(true)} title="Bộ sưu tập thẻ" aria-label="Bộ sưu tập thẻ">
        <span className="text-2xl">🃏</span>
      </button>
      {economy &&
        status &&
        (status.daily.ready ? (
          <button className="reward-slot reward-slot-ready" onClick={() => setWeekly(true)} title="Hộp quà hằng ngày">
            <ChestThumb variant={economy.dailyBox.chest} wobble size={46} />
          </button>
        ) : (
          <button className={`reward-slot ${status.hourly.ready ? 'reward-slot-ready' : ''}`} onClick={() => status.hourly.ready && setOpening('hourly')} title={`Hộp ${economy.boxHours.toLocaleString('vi-VN')} giờ`}>
            <ChestThumb variant={economy.hourlyBox.chest} wobble={status.hourly.ready} size={46} />
            {!status.hourly.ready && <span className="reward-badge">{countdown((status.hourly.readyAt ?? 0) - now())}</span>}
          </button>
        ))}
      <button className="flex min-w-0 items-center gap-2" onClick={() => setMenu((m) => !m)} title="Tài khoản">
        <PlayerAvatar user={user} size={46} className="shrink-0 rounded-full border-[3px] border-white bg-[#bfe3ff] shadow-[0_0_0_2px_#2d3232,0_3px_0_2px_#2d3232]" />
        <span className="text-outline max-w-[34vw] truncate text-lg sm:max-w-56">{name}</span>
      </button>
      {error && !player && <span className="absolute right-0 top-full mt-1 rounded bg-white/90 px-2 text-red-team">{error}</span>}
      {menu && (
        <div className="panel absolute right-0 top-full z-30 mt-3 flex min-w-52 flex-col gap-1 p-2">
          {canAccessCms(user) && (
            <Link href="/admin" className="btn justify-start">
              🛠 CMS quản trị
            </Link>
          )}
          <button className="btn justify-start" onClick={() => void signOut().then(() => setMenu(false))}>
            ⎋ Đăng xuất
          </button>
        </div>
      )}
      {bundle && collection && <Collection bundle={bundle} thumbs={thumbs} onClose={() => setCollection(false)} />}
      {bundle && weekly && (
        <WeeklyReward
          bundle={bundle}
          onClose={() => setWeekly(false)}
          onClaim={() => {
            setWeekly(false);
            setOpening('daily');
          }}
        />
      )}
      {bundle && economy && opening && (
        <BoxOpening
          bundle={bundle}
          kind={opening}
          title={opening === 'daily' ? 'Hộp quà hằng ngày' : `Hộp ${economy.boxHours.toLocaleString('vi-VN')} giờ`}
          chest={opening === 'daily' ? economy.dailyBox.chest : economy.hourlyBox.chest}
          thumbs={thumbs}
          onClose={() => setOpening(null)}
        />
      )}
    </div>
  );
}
