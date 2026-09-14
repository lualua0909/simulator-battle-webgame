'use client';

// Top-right corner of the game: avatar, name and the coin bar (or the sign-in button for guests).
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { formatCoins } from '@/shared/economy';
import { canAccessCms } from '@/shared/users';
import { useAuth } from '@/components/auth/AuthProvider';
import { CoinIcon } from './icons';
import PlayerAvatar from './PlayerAvatar';
import { usePlayer } from './PlayerProvider';

export function CoinBar({ value, loading }: { value: number; loading?: boolean }) {
  return (
    <div className="coin-bar" title="Coin (1 coin = 1 VNĐ)">
      <span className="text-outline ml-auto text-xl leading-none tabular-nums">{loading ? '…' : formatCoins(value)}</span>
      <CoinIcon size={42} className="absolute -right-4 top-1/2 -translate-y-1/2 drop-shadow" />
    </div>
  );
}

export default function PlayerHud() {
  const { user, loading, openAuth, signOut } = useAuth();
  const { player, loading: walletLoading, error } = usePlayer();
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  if (loading) return <div className="coin-bar opacity-60" />;
  if (!user) {
    return (
      <button className="btn btn-gold pointer-events-auto" onClick={() => openAuth('signin')}>
        👤 Đăng nhập
      </button>
    );
  }
  const name = user.displayName || user.email?.split('@')[0] || 'Tướng quân';
  return (
    <div ref={box} className="pointer-events-auto relative flex items-center gap-3">
      <button className="flex min-w-0 items-center gap-2" onClick={() => setMenu((m) => !m)} title="Tài khoản">
        <PlayerAvatar user={user} size={46} className="shrink-0 rounded-full border-[3px] border-white bg-[#bfe3ff] shadow-[0_0_0_2px_#2d3232,0_3px_0_2px_#2d3232]" />
        <span className="text-outline max-w-[34vw] truncate text-lg sm:max-w-56">{name}</span>
      </button>
      <div className="mr-4">
        <CoinBar value={player?.coins ?? 0} loading={walletLoading && !player} />
      </div>
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
    </div>
  );
}
