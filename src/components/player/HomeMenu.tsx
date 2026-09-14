'use client';

// Bottom-left menu of the home screen: today's daily box, the x-hour box once the daily box is
// open, and the card collection. Opens the box and collection screens.
import { useEffect, useState } from 'react';
import { liveBoxes, type BoxKind } from '@/shared/economy';
import type { ChestVariant } from '@/shared/schema';
import { useAuth } from '@/components/auth/AuthProvider';
import { chestThumbnail } from '@/game/render/chestThumbnails';
import { unitThumbnails } from '@/game/render/thumbnails';
import { useConfig } from '@/game/useConfig';
import BoxOpening from './BoxOpening';
import Collection from './Collection';
import { usePlayer, useTick } from './PlayerProvider';

function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function ChestThumb({ variant, wobble }: { variant: ChestVariant; wobble: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void chestThumbnail(variant).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [variant]);
  return <div className="h-[4.5rem] w-[4.5rem] shrink-0">{src && <img src={src} alt="" draggable={false} className={`h-full w-full scale-125 object-contain ${wobble ? 'chest-wobble' : ''}`} />}</div>;
}

export default function HomeMenu() {
  const { bundle } = useConfig();
  const { user, openAuth } = useAuth();
  const { boxes, now } = usePlayer();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState<BoxKind | null>(null);
  const [collection, setCollection] = useState(false);
  useTick(1000);

  useEffect(() => {
    if (bundle && (opening || collection)) void unitThumbnails(bundle).then(setThumbs);
  }, [bundle, opening, collection]);

  if (!bundle) return null;
  const economy = bundle.settings.economy;
  const status = boxes ? liveBoxes(boxes, now()) : null;
  const hours = `Hộp ${economy.boxHours.toLocaleString('vi-VN')} giờ`;

  const slot = (key: string, chest: ChestVariant, title: string, line: React.ReactNode, ready: boolean, onClick: () => void) => (
    <button key={key} className={`dock-slot ${ready ? 'dock-slot-ready' : ''}`} onClick={onClick}>
      <ChestThumb variant={chest} wobble={ready} />
      <span className="flex min-w-0 flex-col items-start text-left">
        <span className="text-outline text-lg leading-tight">{title}</span>
        {line}
      </span>
    </button>
  );

  return (
    <>
      <nav className="pointer-events-auto flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-2">
        {!user
          ? slot('daily', economy.dailyBox.chest, 'Hộp quà hằng ngày', <span className="text-white">Đăng nhập để nhận</span>, true, () => openAuth('signin'))
          : status &&
            slot(
              'daily',
              economy.dailyBox.chest,
              'Hộp quà hằng ngày',
              status.daily.ready ? <span className="dock-ready">MỞ NGAY!</span> : <span className="text-white">Hộp mới sau {countdown(status.daily.resetAt - now())}</span>,
              status.daily.ready,
              () => status.daily.ready && setOpening('daily'),
            )}
        {status?.hourly.unlocked &&
          slot(
            'hourly',
            economy.hourlyBox.chest,
            hours,
            status.hourly.ready ? <span className="dock-ready">MỞ NGAY!</span> : <span className="text-white">Mở sau {countdown((status.hourly.readyAt ?? 0) - now())}</span>,
            status.hourly.ready,
            () => status.hourly.ready && setOpening('hourly'),
          )}
        <button className="dock-slot" onClick={() => setCollection(true)}>
          <span className="flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center text-5xl">🃏</span>
          <span className="text-outline text-lg">Bộ sưu tập thẻ</span>
        </button>
      </nav>
      {collection && <Collection bundle={bundle} thumbs={thumbs} onClose={() => setCollection(false)} />}
      {opening && <BoxOpening bundle={bundle} kind={opening} title={opening === 'daily' ? 'Hộp quà hằng ngày' : hours} chest={opening === 'daily' ? economy.dailyBox.chest : economy.hourlyBox.chest} thumbs={thumbs} onClose={() => setOpening(null)} />}
    </>
  );
}
