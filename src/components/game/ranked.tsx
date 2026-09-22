'use client';

// Ranked mode UI: tier badges, the ranked lobby (standing, queue, season box, leaderboard), the
// opponent bar while deploying and the standing change after a battle. Numbers come from the server.
import { ArrowLeft, ChevronDown, ChevronUp, Gem, Gift, Lock, Star, Swords, Trophy, User, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import BoxOpening from '@/components/player/BoxOpening';
import { formatCoins, type RankState } from '@/shared/economy';
import type { AckResult, RoomState } from '@/shared/net';
import { rankLabel, rankScore, seasonName, type RankResult, type RankView, type StandingRow } from '@/shared/ranked';
import { RANK_TIERS, type ConfigBundle, type RankTier } from '@/shared/schema';
import { useCountdown } from './panels';

// ---------------------------------------------------------------- badges

/** Colours of each tier's trophy: body gradient, trim, gem. */
const TIER_LOOK: Record<RankTier, { top: string; bottom: string; trim: string; gem: string; wings: 0 | 1 | 2 }> = {
  beginner: { top: '#ffb35c', bottom: '#b8561a', trim: '#7a3510', gem: '#ffe2b8', wings: 0 },
  great: { top: '#6fe3ef', bottom: '#1f7fa6', trim: '#ff9d2e', gem: '#e8fbff', wings: 0 },
  expert: { top: '#4a4a57', bottom: '#15151c', trim: '#f2c14e', gem: '#ffd76a', wings: 0 },
  veteran: { top: '#6ea8ff', bottom: '#6b3fe0', trim: '#c9b8ff', gem: '#e9e1ff', wings: 1 },
  ultra: { top: '#ff8ac0', bottom: '#ff8a3d', trim: '#ffe08a', gem: '#fff1f8', wings: 1 },
  master: { top: '#c46bff', bottom: '#ff4f9a', trim: '#ffd166', gem: '#fff6d6', wings: 2 },
};

/** Trophy of a ranked tier: stand, cup and gem, with wings from Veteran up and a crown for Master. */
export function RankBadge({ tier, size = 64, dim = false }: { tier: RankTier; size?: number; dim?: boolean }) {
  const id = useId().replace(/:/g, '');
  const look = TIER_LOOK[tier];
  const wing = (flip: boolean) => {
    const big = look.wings === 2;
    const d = big ? 'M14 30 C2 26 -2 12 2 4 C6 12 10 14 16 16 C10 10 10 4 12 0 C16 8 18 12 20 22 Z' : 'M13 32 C3 30 -2 18 1 5 C6 13 10 17 17 19 Z';
    return <path d={d} fill={`url(#${id}-w)`} stroke={look.trim} strokeWidth="1" transform={flip ? 'translate(64 0) scale(-1 1)' : undefined} />;
  };
  return (
    <svg viewBox="-4 -6 72 80" width={size} height={size * (80 / 72)} aria-hidden className={dim ? 'opacity-35 grayscale' : undefined}>
      <defs>
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={look.top} />
          <stop offset="1" stopColor={look.bottom} />
        </linearGradient>
        <linearGradient id={`${id}-w`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={look.trim} />
          <stop offset="1" stopColor={look.top} />
        </linearGradient>
        <radialGradient id={`${id}-g`} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor={look.gem} />
          <stop offset="1" stopColor={look.top} />
        </radialGradient>
      </defs>
      {look.wings > 0 && (
        <>
          {wing(false)}
          {wing(true)}
        </>
      )}
      {/* stand */}
      <path d="M17 66 H47 L43 57 H21 Z" fill={`url(#${id}-b)`} stroke={look.trim} strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="27" y="45" width="10" height="13" rx="2" fill={look.trim} />
      {/* cup */}
      <path d="M11 12 H53 Q54 40 32 47 Q10 40 11 12 Z" fill={`url(#${id}-b)`} stroke={look.trim} strokeWidth="2" strokeLinejoin="round" />
      <path d="M11 12 H53" stroke={look.trim} strokeWidth="4" strokeLinecap="round" />
      <path d="M17 18 Q18 34 28 40" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* gem */}
      <path d="M32 15 L42 27 L32 40 L22 27 Z" fill={`url(#${id}-g)`} stroke={look.trim} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M22 27 H42 M32 15 L28 27 L32 40 M32 15 L36 27 L32 40" stroke={look.trim} strokeOpacity="0.55" strokeWidth="0.8" fill="none" />
      {tier === 'master' && <path d="M22 6 L25 -3 L29 4 L32 -5 L35 4 L39 -3 L42 6 Z" fill={look.trim} stroke="#b7791f" strokeWidth="1" strokeLinejoin="round" />}
    </svg>
  );
}

export function Diamonds({ filled, total, size = 14 }: { filled: number; total: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${filled}/${total} kim cương`}>
      {Array.from({ length: total }, (_, i) => (
        <svg key={i} viewBox="0 0 10 12" width={size} height={size * 1.2} aria-hidden>
          <path d="M5 0.8 L9.2 6 L5 11.2 L0.8 6 Z" fill={i < filled ? '#ffc233' : '#ffffff'} stroke="#2d3232" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      ))}
    </span>
  );
}

/** Tier name, class and diamonds (or master points) of a standing. */
export function RankLine({ bundle, rank, size = 14 }: { bundle: ConfigBundle; rank: RankState; size?: number }) {
  const cfg = bundle.settings.ranked;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <b>{rankLabel(rank, cfg)}</b>
      {rank.tier !== 'master' && <Diamonds filled={rank.diamonds} total={cfg.tiers[rank.tier].diamonds} size={size} />}
    </span>
  );
}

// ---------------------------------------------------------------- lobby

function timeLeft(ms: number): string {
  const h = Math.max(0, Math.floor(ms / 3_600_000));
  return h >= 48 ? `${Math.floor(h / 24)} ngày` : h >= 1 ? `${h} giờ` : `${Math.max(1, Math.ceil(ms / 60_000))} phút`;
}

export function RankedLobby(props: {
  bundle: ConfigBundle;
  thumbs: Record<string, string>;
  /** Signed-in player's name, or null when signed out. */
  playerName: string | null;
  authLoading: boolean;
  onSignIn(): void;
  connected: boolean;
  error: string | null;
  queue(): Promise<AckResult>;
  cancel(): void;
  flash(msg: string): void;
}) {
  const { bundle } = props;
  const cfg = bundle.settings.ranked;
  const [view, setView] = useState<RankView | null>(null);
  /** Server clock minus device clock: the season countdown follows the server. */
  const [offset, setOffset] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searching, setSearching] = useState<number | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [board, setBoard] = useState(false);
  const [, tick] = useState(0);
  const signedIn = props.playerName !== null;

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ranked', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setView(data as RankView);
      setOffset((data as RankView).now - Date.now());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  useEffect(() => {
    if (searching === null) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [searching]);

  // Leaving the page (or being matched, which unmounts the lobby) drops the queue.
  useEffect(() => () => props.cancel(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!signedIn) {
    return (
      <div className="panel pointer-events-auto m-auto flex w-[min(460px,94vw)] flex-col gap-3 p-4">
        <h2 className="font-display text-2xl">Đấu xếp hạng</h2>
        <p className="text-sm">Cần đăng nhập để đánh xếp hạng. Bậc, kim cương và phần thưởng lưu theo tài khoản.</p>
        <button className="btn btn-gold" disabled={props.authLoading} onClick={props.onSignIn}>
          <User /> Đăng nhập
        </button>
        <Link href="/" className="text-sm underline">
          <ArrowLeft /> Menu
        </Link>
      </div>
    );
  }

  const rank = view?.rank ?? null;
  const tierIndex = rank ? RANK_TIERS.indexOf(rank.tier) : 0;

  const find = async () => {
    setSearching(Date.now());
    const res = await props.queue();
    if (!res.ok) {
      setSearching(null);
      props.flash(res.error);
      void load();
    }
  };

  return (
    <div className="panel pointer-events-auto m-auto flex w-[min(640px,94vw)] flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl">Đấu xếp hạng</h2>
        {view?.season && (
          <span className="text-sm font-bold">
            {view.season.name} · còn {timeLeft(view.season.endsAt - (Date.now() + offset))}
          </span>
        )}
      </div>

      {loadError && <p className="text-sm text-red-team">{loadError}</p>}
      {!view && !loadError && <p className="text-sm opacity-70">Đang tải…</p>}

      {view && (
        <>
          {/* Tier ladder, current tier raised. */}
          <div className="grid grid-cols-6 items-end gap-1 rounded-xl border-2 border-ink/20 bg-gradient-to-b from-[#2a1f6e] to-[#5b2bb5] px-1 pb-1 pt-2 sm:px-2">
            {RANK_TIERS.map((t, i) => (
              <div key={t} className={`flex flex-col items-center rounded-lg pb-1 text-center text-white ${i === tierIndex ? 'bg-white/20 ring-2 ring-gold' : ''}`}>
                <RankBadge tier={t} size={i === tierIndex ? 52 : 40} dim={i > tierIndex} />
                <span className="text-[10px] font-bold leading-tight sm:text-xs">{cfg.tiers[t].name}</span>
              </div>
            ))}
          </div>

          {rank && (
            <div className="flex items-center gap-3">
              <RankBadge tier={rank.tier} size={84} />
              <div className="flex min-w-0 flex-col gap-1">
                <RankLine bundle={bundle} rank={rank} size={16} />
                <span className="text-sm">
                  {rank.wins} thắng · {rank.losses} thua{rank.draws > 0 ? ` · ${rank.draws} hòa` : ''}
                </span>
                <span className="text-xs opacity-70">Thắng +1 <Gem />, thua −1 <Gem /> (bậc {cfg.tiers.beginner.name} không mất <Gem />). Đủ <Gem /> thắng thêm 1 trận để lên hạng.</span>
              </div>
            </div>
          )}

          {view.pending && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-gold bg-[#fff6d6] p-2">
              <RankBadge tier={view.pending.tier} size={40} />
              <span className="flex-1 text-sm">
                {seasonName(view.pending.season)} đã kết thúc ở bậc <b>{cfg.tiers[view.pending.tier].name}</b>.
              </span>
              <button className="btn btn-gold" onClick={() => setClaiming(true)}>
                <Gift /> Nhận thưởng mùa
              </button>
            </div>
          )}

          {view.gate && !view.pending && <p className="rounded-lg bg-ink/5 p-2 text-sm"><Lock /> {view.gate}</p>}

          <p className={`text-xs ${props.error ? 'text-red-team' : 'opacity-60'}`}>{props.connected ? 'Đã kết nối máy chủ.' : (props.error ?? 'Đang kết nối máy chủ…')}</p>

          {searching === null ? (
            <button className="btn btn-gold text-lg" disabled={!props.connected || !!view.gate || !view.season} onClick={() => void find()}>
              <Swords /> Tìm trận
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="flex-1 font-display text-lg">
                Đang tìm đối thủ… {Math.floor((Date.now() - searching) / 1000)}s
              </span>
              <button
                className="btn"
                onClick={() => {
                  props.cancel();
                  setSearching(null);
                }}
              >
                Hủy
              </button>
            </div>
          )}

          <div className="flex justify-between">
            <Link href="/" className="btn">
              <ArrowLeft /> Menu
            </Link>
            {view.season && (
              <button className="btn" onClick={() => setBoard(true)}>
                <Trophy /> Bảng xếp hạng
              </button>
            )}
          </div>
        </>
      )}

      {claiming && view?.pending && (
        <BoxOpening
          bundle={bundle}
          action={{ action: 'rank-claim' }}
          title={`Thưởng ${seasonName(view.pending.season)}: ${cfg.tiers[view.pending.tier].name}`}
          chest={cfg.tiers[view.pending.tier].seasonBox.chest}
          thumbs={props.thumbs}
          onClose={() => {
            setClaiming(false);
            void load();
          }}
        />
      )}
      {board && view?.season && <Leaderboard bundle={bundle} season={view.season.id} onClose={() => setBoard(false)} />}
    </div>
  );
}

function Leaderboard({ bundle, season, onClose }: { bundle: ConfigBundle; season: string; onClose(): void }) {
  const [data, setData] = useState<{ rows: StandingRow[]; me: StandingRow | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetch(`/api/ranked?board=${season}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        setData(body);
      })
      .catch((e: Error) => setError(e.message));
  }, [season]);
  const line = (r: StandingRow) => (
    <li key={`${r.position}-${r.name}`} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${r.self ? 'bg-gold/60' : 'odd:bg-ink/5'}`}>
      <span className="w-8 text-right font-display tabular-nums">{r.position}</span>
      <RankBadge tier={r.tier} size={30} />
      <span className="min-w-0 flex-1 truncate font-bold">{r.name}</span>
      <span className="hidden text-xs sm:inline">
        <RankLine bundle={bundle} rank={{ ...r, season, draws: 0, disputes: 0, rewardDay: null, rewardsToday: 0 }} size={10} />
      </span>
      <span className="w-16 text-right text-xs tabular-nums">
        {r.wins}T/{r.losses}B
      </span>
    </li>
  );
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-3" onClick={onClose}>
      <div className="panel flex max-h-[86vh] w-[min(560px,94vw)] flex-col gap-2 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl">Bảng xếp hạng · {seasonName(season)}</h3>
          <button className="btn px-2 py-0.5" onClick={onClose} aria-label="Đóng">
            <X />
          </button>
        </div>
        {error && <p className="text-sm text-red-team">{error}</p>}
        {!data && !error && <p className="text-sm opacity-70">Đang tải…</p>}
        {data && data.rows.length === 0 && <p className="text-sm opacity-70">Chưa ai đánh xếp hạng mùa này.</p>}
        {data && (
          <ol className="flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain text-sm">
            {data.rows.map(line)}
            {data.me && !data.rows.some((r) => r.self) && (
              <>
                <li className="text-center text-xs opacity-50">…</li>
                {line(data.me)}
              </>
            )}
          </ol>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- deploy + result

/** Ranked deploy panel: season, opponent and the start countdown (settings are fixed). */
export function RankedBar({ bundle, room, opponent, mySide }: { bundle: ConfigBundle; room: RoomState; opponent: { name: string; rank: RankState | null } | null; mySide: string }) {
  const secondsLeft = useCountdown(room.deadline);
  const map = bundle.maps.find((m) => m.id === room.mapId);
  const other = Object.entries(room.players).find(([s]) => s !== mySide)?.[1];
  return (
    <div className="panel pointer-events-auto flex w-56 flex-col gap-1.5 p-2 text-sm sm:w-64">
      <div className="font-display"><Trophy /> Xếp hạng · {room.ranked ? seasonName(room.ranked) : ''}</div>
      {secondsLeft !== null && <div className={`text-center font-display text-lg ${secondsLeft <= 10 ? 'text-red-team' : ''}`}>Bắt đầu sau {secondsLeft}s</div>}
      <div className="flex items-center gap-2">
        {opponent?.rank ? <RankBadge tier={opponent.rank.tier} size={36} /> : <RankBadge tier="beginner" size={36} />}
        <div className="min-w-0">
          <div className="truncate font-bold">Đối thủ: {opponent?.name ?? other?.name ?? '?'}</div>
          {opponent?.rank && (
            <div className="text-xs">
              <RankLine bundle={bundle} rank={opponent.rank} size={9} />
            </div>
          )}
          {other && !other.connected && <div className="text-xs text-red-team">mất kết nối</div>}
          {other?.ready && <span className="rounded bg-green-600 px-1.5 text-xs font-bold text-white">SẴN SÀNG</span>}
        </div>
      </div>
      <div className="text-xs opacity-70">
        {map?.name ?? room.mapId} · ngân sách {room.budget} · <Star /> tính sao
      </div>
    </div>
  );
}

function holdReason(r: RankResult, cfg: ConfigBundle['settings']['ranked']): string | null {
  if (r.verdict.outcome === 'void') return 'Hai máy báo kết quả khác nhau — trận không tính, đã ghi nhận để kiểm tra.';
  if (r.verdict.move || r.verdict.outcome === 'draw') return null;
  if (r.flags.includes('repeat-pair')) return `Hai tài khoản này đã đấu đủ ${cfg.pairDailyLimit} trận xếp hạng hôm nay — trận này không tính kim cương.`;
  if (r.flags.includes('early-end')) return 'Đối thủ bỏ trận quá sớm — thắng nhưng không cộng kim cương.';
  if (r.flags.includes('weak-army')) return 'Đội hình đối thủ quá mỏng so với ngân sách — thắng nhưng không cộng kim cương.';
  return null;
}

/** Standing before → after of the battle that just ended, and the win box it paid. */
export function RankResultPanel({ bundle, res }: { bundle: ConfigBundle; res: AckResult<RankResult> | null }) {
  if (!res) return <p className="text-sm opacity-70">Đang cập nhật xếp hạng…</p>;
  if (!res.ok) return <p className="text-sm text-red-team">{res.error}</p>;
  const cfg = bundle.settings.ranked;
  const diff = rankScore(res.after, cfg) - rankScore(res.before, cfg);
  const reason = holdReason(res, cfg);
  const cards = res.reward?.cards.reduce((n, c) => n + c.count, 0) ?? 0;
  return (
    <div className="flex w-full flex-col items-center gap-1 rounded-xl bg-ink/5 p-2 text-sm">
      <div className="flex items-center gap-2">
        <RankBadge tier={res.before.tier} size={40} dim={diff > 0} />
        <span className={`font-display text-xl ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-team' : ''}`}>{diff > 0 ? <ChevronUp /> : diff < 0 ? <ChevronDown /> : '='}</span>
        <RankBadge tier={res.after.tier} size={52} />
      </div>
      <RankLine bundle={bundle} rank={res.after} />
      {res.before.tier !== res.after.tier && <b className="text-base">{RANK_TIERS.indexOf(res.after.tier) > RANK_TIERS.indexOf(res.before.tier) ? `Lên bậc ${cfg.tiers[res.after.tier].name}!` : `Rớt xuống ${cfg.tiers[res.after.tier].name}`}</b>}
      {reason && <p className="text-xs opacity-80">{reason}</p>}
      {res.reward && (
        <p className="font-bold">
          <Gift /> +{formatCoins(res.reward.coins)} xu{cards > 0 ? ` · +${cards} thẻ` : ''}
        </p>
      )}
    </div>
  );
}
