'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { BotDef, ConfigBundle } from '@/shared/schema';
import type { RoomSettings, RoomState } from '@/shared/net';
import { ALL_SIDES, type Side } from '@/game/sim/terrain';
import type { BattleResult } from '@/game/sim/world';
import type { BattleStats } from '@/game/render/engine';

export const SIDE_NAME: Record<Side, string> = { blue: 'Xanh', red: 'Đỏ', green: 'Lục', yellow: 'Vàng' };
export const SIDE_BG: Record<Side, string> = { blue: 'bg-blue-team', red: 'bg-red-team', green: 'bg-green-team', yellow: 'bg-yellow-team' };
export const SIDE_TEXT: Record<Side, string> = { blue: 'text-blue-team', red: 'text-red-team', green: 'text-green-team', yellow: 'text-yellow-team' };

/** Mode picker value: open battle, or siege with the given side defending. */
export type ModeChoice = 'battle' | Side;

export function ModePicker(props: { mode: 'bot' | 'local' | 'online'; value: ModeChoice; onChange(v: ModeChoice): void; disabled?: boolean }) {
  const options: Array<{ value: ModeChoice; label: string; hint: string }> =
    props.mode === 'bot'
      ? [
          { value: 'battle', label: '⚔ Đại chiến', hint: 'hai đạo quân lao vào nhau' },
          { value: 'blue', label: '🏰 Bạn thủ thành', hint: 'xây tường, tháp; máy công thành' },
          { value: 'red', label: '🔥 Bạn công thành', hint: 'máy xây thành, bạn phá' },
        ]
      : [
          { value: 'battle', label: '⚔ Đại chiến', hint: 'hai đạo quân lao vào nhau' },
          { value: 'blue', label: '🏰 Thủ thành: Xanh thủ', hint: 'Đỏ công thành' },
          { value: 'red', label: '🏰 Thủ thành: Đỏ thủ', hint: 'Xanh công thành' },
        ];
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <button key={o.value} disabled={props.disabled} onClick={() => props.onChange(o.value)} className={`rounded-xl border-2 p-2 text-left ${props.value === o.value ? 'border-ink bg-gold' : 'border-ink/30 bg-white'}`}>
          <div className="font-bold">{o.label}</div>
          <div className="text-xs opacity-70">{o.hint}</div>
        </button>
      ))}
    </div>
  );
}

export function resultTitle(result: BattleResult, mySide?: Side): string {
  if (result.winner === 'draw') return 'HÒA!';
  if (mySide) return result.winner === mySide ? 'CHIẾN THẮNG!' : 'THẤT BẠI!';
  return `${SIDE_NAME[result.winner].toUpperCase()} THẮNG!`;
}

/** Letterbox bars + skip button while a cinematic owns the camera. */
export function CinematicBars({ title, winner, onSkip }: { title?: string; winner?: Side | 'draw'; onSkip(): void }) {
  const color = winner && winner !== 'draw' ? SIDE_TEXT[winner] : 'text-ink';
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="cine-bar absolute inset-x-0 top-0 h-[9vh] origin-top bg-black/85" />
      <div className="cine-bar absolute inset-x-0 bottom-0 flex h-[9vh] origin-bottom items-center justify-end bg-black/85 px-4">
        <button className="pointer-events-auto rounded-lg border-2 border-white/70 px-3 py-1 text-sm font-bold text-white hover:bg-white/15" onClick={onSkip}>
          Bỏ qua ▸
        </button>
      </div>
      {title && <div className={`cine-title absolute inset-x-0 top-[13vh] text-center font-display text-5xl sm:text-6xl ${color}`}>{title}</div>}
    </div>
  );
}

/** Thứ tự hiển thị bắt buộc: Dễ / Thường / Khó / Huyền thoại. */
export const BOT_ORDER = ['de', 'thuong', 'kho', 'huyen-thoai'];

/** Bot sắp theo BOT_ORDER trước, bot lạ (CMS thêm tay) xếp sau theo difficulty. */
export function orderedBots(bundle: ConfigBundle): BotDef[] {
  return [...bundle.bots].sort((a, b) => {
    const ia = BOT_ORDER.indexOf(a.id);
    const ib = BOT_ORDER.indexOf(b.id);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.difficulty - b.difficulty;
  });
}

/** Huy hiệu rank cho từng cấp độ: 0 Dễ (bạc), 1 Thường (lục), 2 Khó (lam), 3 Huyền thoại (tím + cánh vàng). */
function RankIcon({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <svg viewBox="0 0 48 48" className="h-12 w-12 sm:h-16 sm:w-16" aria-hidden>
        <defs>
          <linearGradient id="rk-ring-1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d6a94c" />
            <stop offset="1" stopColor="#5c4a12" />
          </linearGradient>
        </defs>
        <path d="M6 32 Q13 28 16 21 Q13 31 9 34 Z" fill="#8a6d1f" />
        <path d="M42 32 Q35 28 32 21 Q35 31 39 34 Z" fill="#8a6d1f" />
        <circle cx="24" cy="24" r="20" fill="url(#rk-ring-1)" stroke="#3f3308" strokeWidth="2" />
        <circle cx="24" cy="24" r="13.5" fill="#0e2a12" />
        <path d="M24 13 L30 24 L24 35 L18 24 Z" fill="#22c55e" stroke="#bbf7d0" strokeWidth="1.5" />
        <circle cx="24" cy="24" r="2.5" fill="#dcfce7" />
      </svg>
    );
  if (rank === 2)
    return (
      <svg viewBox="0 0 48 48" className="h-12 w-12 sm:h-16 sm:w-16" aria-hidden>
        <defs>
          <linearGradient id="rk-ring-2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f1f5f9" />
            <stop offset="1" stopColor="#64748b" />
          </linearGradient>
        </defs>
        <path d="M4 26 L10 24 L10 30 Z" fill="#94a3b8" />
        <path d="M44 26 L38 24 L38 30 Z" fill="#94a3b8" />
        <circle cx="24" cy="24" r="20" fill="url(#rk-ring-2)" stroke="#334155" strokeWidth="2" />
        <circle cx="24" cy="24" r="13.5" fill="#0c1a33" />
        <path d="M24 12 L31 24 L24 36 L17 24 Z" fill="#38bdf8" stroke="#e0f2fe" strokeWidth="1.5" />
        <path d="M17 24 L24 21 L31 24 L24 27 Z" fill="#bae6fd" opacity="0.85" />
        <circle cx="24" cy="24" r="2.5" fill="#f0f9ff" />
      </svg>
    );
  if (rank === 3)
    return (
      <svg viewBox="0 0 48 48" className="h-12 w-12 sm:h-16 sm:w-16" aria-hidden>
        <defs>
          <linearGradient id="rk-ring-3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset="0.55" stopColor="#d97706" />
            <stop offset="1" stopColor="#92400e" />
          </linearGradient>
          <radialGradient id="rk-glow-3" cx="0.5" cy="0.45" r="0.6">
            <stop offset="0" stopColor="#e9d5ff" />
            <stop offset="1" stopColor="#4c1d95" />
          </radialGradient>
        </defs>
        <path d="M3 30 Q11 27 15 18 Q13 29 7 33 Z" fill="#b45309" />
        <path d="M45 30 Q37 27 33 18 Q35 29 41 33 Z" fill="#b45309" />
        <path d="M5 34 Q12 32 15 25 Q13 34 8 37 Z" fill="#f59e0b" opacity="0.8" />
        <path d="M43 34 Q36 32 33 25 Q35 34 40 37 Z" fill="#f59e0b" opacity="0.8" />
        <circle cx="24" cy="24" r="20" fill="url(#rk-ring-3)" stroke="#451a03" strokeWidth="2" />
        <circle cx="24" cy="24" r="13.5" fill="url(#rk-glow-3)" />
        <path d="M24 12 L31 24 L24 36 L17 24 Z" fill="#a855f7" stroke="#fae8ff" strokeWidth="1.5" />
        <path d="M17 24 L24 21 L31 24 L24 27 Z" fill="#e9d5ff" opacity="0.9" />
        <circle cx="24" cy="24" r="2.5" fill="#faf5ff" />
        <circle cx="15" cy="10" r="1.3" fill="#fde68a" />
        <circle cx="34" cy="9" r="1.3" fill="#fde68a" />
      </svg>
    );
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12 sm:h-16 sm:w-16" aria-hidden>
      <defs>
        <linearGradient id="rk-ring-0" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3f4f6" />
          <stop offset="1" stopColor="#6b7280" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="20" fill="url(#rk-ring-0)" stroke="#374151" strokeWidth="2" />
      <circle cx="24" cy="24" r="13.5" fill="#1f2937" />
      <path d="M24 14 L29 24 L24 34 L19 24 Z" fill="#9ca3af" stroke="#e5e7eb" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="2.5" fill="#e5e7eb" />
    </svg>
  );
}

export function SetupPanel(props: {
  bundle: ConfigBundle;
  mode: 'bot' | 'local';
  mapId: string;
  setMapId(id: string): void;
  budget: number;
  setBudget(v: number): void;
  botId: string;
  setBotId(id: string): void;
  botCount: number;
  setBotCount(n: number): void;
  blind: boolean;
  setBlind(v: boolean): void;
  choice: ModeChoice;
  setChoice(v: ModeChoice): void;
  onStart(): void;
}) {
  const { bundle, mode } = props;
  return (
    <div className="panel pointer-events-auto m-auto flex w-[min(760px,94vw)] flex-col gap-2 p-3 sm:max-h-[88vh] sm:gap-3 sm:overflow-y-auto sm:overscroll-contain sm:touch-pan-y sm:p-4">
      <h2 className="font-display text-2xl">{mode === 'bot' ? 'Đấu với máy' : '2 người 1 máy'}</h2>
      <section>
        <h3 className="mb-1 text-sm font-extrabold uppercase opacity-70">Chế độ</h3>
        <ModePicker mode={mode} value={props.choice} onChange={props.setChoice} />
        {props.choice !== 'battle' && <p className="mt-1 text-xs opacity-70">Phe thủ chỉ đứng trong vùng của mình, cần 1 Nhà chính. Phe công phá Nhà chính để thắng; hết giờ thì phe thủ thắng.</p>}
      </section>
      <section>
        <h3 className="mb-1 text-sm font-extrabold uppercase opacity-70">Bản đồ</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {bundle.maps.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                props.setMapId(m.id);
                props.setBudget(m.budget);
              }}
              className={`rounded-xl border-2 p-2 text-left ${props.mapId === m.id ? 'border-ink bg-gold' : 'border-ink/30 bg-white'}`}
            >
              <div className="h-8 rounded-md" style={{ background: `linear-gradient(180deg, ${m.skyTop}, ${m.skyBottom} 55%, ${m.grassColor} 56%, ${m.dirtColor})` }} />
              <div className="mt-1 font-bold">{m.name}</div>
              <div className="text-xs opacity-70">
                {m.size}m {m.river.enabled ? '· có sông' : ''} {m.defenseDepth > 0 ? '· 🏰' : ''}
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="flex items-center gap-2 sm:gap-3">
        <h3 className="shrink-0 text-sm font-extrabold uppercase opacity-70">Ngân sách</h3>
        <input type="range" min={300} max={30000} step={100} value={props.budget} onChange={(e) => props.setBudget(Number(e.target.value))} className="min-w-0 flex-1" />
        <input type="number" min={100} step={100} value={props.budget} onChange={(e) => props.setBudget(Math.max(100, Number(e.target.value) || 0))} className="field flex-none shrink-0" style={{ width: '5.5rem' }} />
        {mode === 'bot' && props.choice === 'battle' && (
          <select value={props.botCount} onChange={(e) => props.setBotCount(Number(e.target.value))} className="field flex-none shrink-0" style={{ width: 'auto' }} title="Số lượng bot" aria-label="Số lượng bot">
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n} bot
              </option>
            ))}
          </select>
        )}
      </section>
      {mode === 'bot' ? (
        <section>
          <h3 className="mb-1 text-sm font-extrabold uppercase opacity-70">Đối thủ</h3>
          <div className="grid grid-cols-4 gap-1 sm:gap-2">
            {orderedBots(bundle).map((b) => {
              const active = props.botId === b.id;
              return (
                <button key={b.id} onClick={() => props.setBotId(b.id)} className="group flex flex-col items-center gap-1 bg-transparent p-1 text-center font-bold sm:p-2">
                  <span
                    className={`transition-all duration-150 group-hover:-translate-y-1 group-hover:scale-110 group-hover:opacity-100 group-hover:drop-shadow-[0_8px_14px_rgba(255,178,0,0.55)] ${
                      active ? '-translate-y-1 scale-110 drop-shadow-[0_8px_14px_rgba(255,178,0,0.65)]' : 'opacity-70'
                    }`}
                  >
                    <RankIcon rank={BOT_ORDER.indexOf(b.id)} />
                  </span>
                  <span className={`whitespace-nowrap text-[11px] leading-tight sm:text-base ${active ? '' : 'opacity-70 group-hover:opacity-100'}`}>{b.name}</span>
                  <span className={`h-1 w-8 rounded-full transition-colors sm:w-10 ${active ? 'bg-gold' : 'bg-transparent group-hover:bg-ink/20'}`} />
                </button>
              );
            })}
          </div>
          {props.choice !== 'battle' && <p className="mt-1 text-xs opacity-70">Thủ/công thành chỉ đấu 1 bot.</p>}
        </section>
      ) : (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={props.blind} onChange={(e) => props.setBlind(e.target.checked)} />
          Xếp quân bí mật (không thấy quân đối phương khi đặt)
        </label>
      )}
      <div className="flex justify-between">
        <Link href="/" className="btn">
          ← Menu
        </Link>
        <button className="btn btn-gold text-lg" onClick={props.onStart}>
          Vào xếp quân →
        </button>
      </div>
    </div>
  );
}

export function OnlineLobby(props: {
  /** Signed-in player's name, or null when signed out. */
  playerName: string | null;
  authLoading: boolean;
  onSignIn(): void;
  connected: boolean;
  error: string | null;
  initialCode?: string;
  onCreate(): void;
  onJoin(code: string): void;
  busy: boolean;
}) {
  const [code, setCode] = useState(props.initialCode ?? '');
  if (props.playerName === null) {
    return (
      <div className="panel pointer-events-auto m-auto flex w-[min(460px,94vw)] flex-col gap-3 p-4">
        <h2 className="font-display text-2xl">Đấu online</h2>
        <p className="text-sm">Cần đăng nhập để đấu online. Kết quả trận được lưu theo tài khoản.</p>
        <button className="btn btn-gold" disabled={props.authLoading} onClick={props.onSignIn}>
          👤 Đăng nhập
        </button>
        <Link href="/" className="text-sm underline">
          ← Menu
        </Link>
      </div>
    );
  }
  return (
    <div className="panel pointer-events-auto m-auto flex w-[min(460px,94vw)] flex-col gap-3 p-4">
      <h2 className="font-display text-2xl">Đấu online</h2>
      <p className="text-sm">
        Chơi với tên <b>{props.playerName}</b>
      </p>
      <p className={`text-sm ${props.error ? 'text-red-team' : 'opacity-75'}`}>{props.connected ? 'Đã kết nối máy chủ.' : (props.error ?? 'Đang kết nối máy chủ…')}</p>
      <button className="btn btn-gold" disabled={!props.connected || props.busy} onClick={props.onCreate}>
        Tạo phòng mới
      </button>
      <div className="flex items-center gap-2 text-xs uppercase opacity-60">
        <span className="h-px flex-1 bg-ink/30" /> hoặc <span className="h-px flex-1 bg-ink/30" />
      </div>
      <div className="flex gap-2">
        <input className="field font-mono uppercase" maxLength={5} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="MÃ PHÒNG" />
        <button
          className="btn"
          disabled={code.length < 5 || !props.connected || props.busy}
          onClick={() => props.onJoin(code)}
        >
          Vào phòng
        </button>
      </div>
      <Link href="/" className="text-sm underline">
        ← Menu
      </Link>
    </div>
  );
}

/** Live "Ns" readout of a deployment deadline (or null once it's stopped counting down). */
export function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function RoomBar(props: { bundle: ConfigBundle; room: RoomState; mySide: Side; onSettings(next: RoomSettings): void }) {
  const { room, mySide, bundle } = props;
  const current: RoomSettings = { mapId: room.mapId, budget: room.budget, useStars: room.useStars, defense: room.defense };
  const set = (patch: Partial<RoomSettings>) => props.onSettings({ ...current, ...patch });
  const host = mySide === 'blue';
  const link = typeof window !== 'undefined' ? `${window.location.origin}/play?mode=online&room=${room.code}` : '';
  const [copied, setCopied] = useState(false);
  const secondsLeft = useCountdown(room.deadline);
  /** Siege is 2-side only; an open room can seat up to 4. */
  const slots = room.defense !== null ? (['blue', 'red'] as const) : ALL_SIDES;
  return (
    <div className="panel pointer-events-auto flex max-h-[26vh] w-52 flex-col gap-2 overflow-y-auto overscroll-contain p-2 text-sm sm:max-h-none sm:w-auto sm:overflow-visible">
      <div className="flex items-center gap-2">
        <span className="font-display">Phòng {room.code}</span>
        <button
          className="btn px-2 py-0.5 text-xs"
          onClick={() => {
            void navigator.clipboard?.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Đã chép!' : 'Chép link mời'}
        </button>
      </div>
      {secondsLeft !== null && (
        <div className={`text-center font-display text-lg ${secondsLeft <= 10 ? 'text-red-team' : ''}`}>Bắt đầu sau {secondsLeft}s</div>
      )}
      {slots.map((s) => {
        const p = room.players[s];
        return (
          <div key={s} className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full ${SIDE_BG[s]}`} />
            <span className="font-bold">{p ? p.name : '— đang chờ —'}</span>
            {s === mySide && <span className="text-xs opacity-60">(bạn)</span>}
            {p && !p.connected && <span className="text-xs text-red-team">mất kết nối</span>}
            {p?.ready && <span className="ml-auto rounded bg-green-600 px-1.5 text-xs font-bold text-white">SẴN SÀNG</span>}
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <select className="field" disabled={!host} value={room.mapId} onChange={(e) => set({ mapId: e.target.value, budget: bundle.maps.find((m) => m.id === e.target.value)?.budget ?? room.budget })}>
          {bundle.maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input className="field w-24" type="number" step={100} disabled={!host} value={room.budget} onChange={(e) => set({ budget: Math.max(100, Number(e.target.value) || 100) })} />
      </div>
      <select className="field" disabled={!host} value={room.defense ?? 'battle'} onChange={(e) => set({ defense: e.target.value === 'battle' ? null : (e.target.value as Side) })}>
        <option value="battle">⚔ Đại chiến</option>
        <option value="blue">🏰 Thủ thành: Xanh thủ</option>
        <option value="red">🏰 Thủ thành: Đỏ thủ</option>
      </select>
      <label className="flex items-center gap-2" title="Lính đã nâng sao được cộng máu và sát thương theo sao của từng người">
        <input type="checkbox" disabled={!host} checked={room.useStars} onChange={(e) => set({ useStars: e.target.checked })} />
        ⭐ Tính sao nâng cấp của lính
      </label>
      {!host && <p className="text-xs opacity-60">Chủ phòng (Xanh) chọn bản đồ, ngân sách, chế độ và có tính sao hay không.</p>}
    </div>
  );
}

export function HelpHint({ text, className = '' }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`pointer-events-auto relative shrink-0 ${className}`}>
      <button
        className="panel flex h-7 w-7 items-center justify-center rounded-full text-sm opacity-70 hover:opacity-100"
        onClick={() => setOpen((o) => !o)}
        title="Hướng dẫn điều khiển"
        aria-label="Hướng dẫn điều khiển"
      >
        ?
      </button>
      {open && <div className="panel absolute bottom-9 left-0 z-10 w-60 p-2 text-xs leading-tight">{text}</div>}
    </div>
  );
}

export function BattleHud(props: {
  activeSides: Side[];
  stats: BattleStats;
  total: Partial<Record<Side, number>>;
  speed: number;
  paused: boolean;
  muted: boolean;
  onMute(): void;
  onSpeed(s: number): void;
  onPause(): void;
  onStop(): void;
  stopLabel: string;
  timeLimit: number;
  defense: Side | null;
}) {
  const { stats, total, activeSides } = props;
  const left = Math.max(0, props.timeLimit - stats.time);
  const mm = Math.floor(left / 60);
  const ss = Math.floor(left % 60)
    .toString()
    .padStart(2, '0');
  const mid = Math.ceil(activeSides.length / 2);
  const leftSides = activeSides.slice(0, mid);
  const rightSides = activeSides.slice(mid);
  return (
    <>
      <div
        className="panel pointer-events-auto absolute left-1/2 top-2 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1.5 overflow-hidden whitespace-nowrap px-2.5 py-1.5 sm:top-3 sm:gap-2 sm:px-3.5 sm:py-1.5"
        style={{ borderRadius: 9999 }}
      >
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          {leftSides.map((s) => (
            <TeamBar key={s} side={s} alive={stats.alive[s] ?? 0} total={total[s] ?? 0} flip={false} />
          ))}
        </div>
        <div className="h-5 w-px shrink-0 bg-ink/15" />
        <span
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-display tabular-nums leading-none text-white sm:px-2.5 sm:text-lg ${left < 30 ? 'bg-red-team' : 'bg-ink'}`}
          title={props.defense ? `Thời gian còn lại · Phe ${SIDE_NAME[props.defense]} thủ thành` : 'Thời gian còn lại'}
        >
          ⏱ {mm}:{ss}
          {props.defense && (
            <span className="text-[11px] leading-none" title={`Phe ${SIDE_NAME[props.defense]} thủ`}>
              🏰
            </span>
          )}
        </span>
        <div className="h-5 w-px shrink-0 bg-ink/15" />
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          {rightSides.map((s) => (
            <TeamBar key={s} side={s} alive={stats.alive[s] ?? 0} total={total[s] ?? 0} flip={true} />
          ))}
        </div>
      </div>
      <div className="panel pointer-events-auto absolute bottom-2 right-2 flex max-w-[64vw] flex-wrap items-center justify-end gap-1 p-1.5 sm:bottom-3 sm:right-3 sm:max-w-none sm:p-2">
        <button className={`btn px-3 py-1 ${props.muted ? 'btn-gold' : ''}`} onClick={props.onMute} title="Bật/tắt âm thanh">
          {props.muted ? '🔇' : '🔊'}
        </button>
        <button className={`btn px-3 py-1 ${props.paused ? 'btn-gold' : ''}`} onClick={props.onPause} title="Space">
          {props.paused ? '▶' : '❚❚'}
        </button>
        {[0.25, 1, 2, 4].map((s, i) => (
          <button key={s} className={`btn px-2 py-1 text-sm ${props.speed === s ? 'btn-gold' : ''}`} onClick={() => props.onSpeed(s)} title={`Phím ${i + 1}`}>
            {s}×
          </button>
        ))}
        <button className="btn ml-2 px-2 py-1 text-sm" onClick={props.onStop}>
          {props.stopLabel}
        </button>
      </div>
      <HelpHint className="absolute bottom-3 left-3" text="Chuột trái/giữa kéo: kéo bản đồ · Chuột phải kéo: xoay/nghiêng · Lăn/pinch: zoom theo con trỏ · WASD/QE" />
    </>
  );
}

function TeamBar({ side, alive, total, flip }: { side: Side; alive: number; total: number; flip: boolean }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (alive / total) * 100)) : 0;
  return (
    <div className={`flex shrink-0 items-center gap-1 sm:gap-1.5 ${flip ? 'flex-row-reverse' : ''}`} title={`${SIDE_NAME[side]}: còn ${alive}/${total}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ring-1 ring-ink/60 ${SIDE_BG[side]}`} />
      <span className={`font-display tabular-nums sm:text-lg ${SIDE_TEXT[side]}`}>{alive}</span>
      <div className="h-2.5 w-9 overflow-hidden rounded-full border border-ink/80 bg-black/10 sm:h-3 sm:w-20 lg:w-24">
        <div className={`h-full rounded-full transition-[width] duration-300 ${SIDE_BG[side]}`} style={{ width: `${pct}%`, marginLeft: flip ? 'auto' : undefined }} />
      </div>
    </div>
  );
}

export function ResultModal(props: { result: BattleResult; mySide?: Side; siege: boolean; onRematch(): void; onEdit?(): void; rematchLabel?: string; children?: ReactNode }) {
  const { result } = props;
  const title = resultTitle(result, props.mySide);
  const color = result.winner !== 'draw' ? SIDE_TEXT[result.winner] : 'text-ink';
  const survivors = ALL_SIDES.filter((s) => result.survivors[s] !== undefined);
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-ink/25">
      <div className="panel flex w-[min(420px,92vw)] flex-col items-center gap-3 p-6 text-center">
        <div className={`font-display text-4xl ${color}`}>{title}</div>
        <p className="text-sm opacity-80">
          {result.reason === 'surrender'
            ? props.mySide && result.winner === props.mySide
              ? 'Đối thủ đã dừng trận!'
              : 'Bạn đã dừng trận.'
            : result.reason === 'core'
              ? 'Nhà chính đã bị phá hủy!'
              : result.reason === 'timeout'
                ? props.siege
                  ? 'Hết giờ — phe thủ đã giữ được thành.'
                  : 'Hết giờ — hai bên hòa nhau.'
                : 'Một bên đã bị tiêu diệt hoàn toàn.'}
          <br />
          Còn sống:{' '}
          {survivors.map((s, i) => (
            <span key={s}>
              {i > 0 && ' · '}
              <b className={SIDE_TEXT[s]}>{result.survivors[s]}</b> {SIDE_NAME[s].toLowerCase()}
            </span>
          ))}{' '}
          · {(result.tick / 30).toFixed(0)} giây
        </p>
        {props.children}
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn btn-gold" onClick={props.onRematch}>
            {props.rematchLabel ?? 'Đấu lại'}
          </button>
          {props.onEdit && (
            <button className="btn" onClick={props.onEdit}>
              Sửa đội hình
            </button>
          )}
          <Link href="/" className="btn">
            Menu
          </Link>
        </div>
      </div>
    </div>
  );
}

export function Handoff({ onContinue }: { onContinue(): void }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-red-team">
      <div className="flex flex-col items-center gap-4 text-center text-white">
        <div className="font-display text-4xl">Tới lượt người chơi 2</div>
        <p className="max-w-sm">Người chơi 1 hãy quay đi nhé! Người chơi 2 xếp quân phe Đỏ.</p>
        <button className="btn text-lg" onClick={onContinue}>
          Tôi là người chơi 2 →
        </button>
      </div>
    </div>
  );
}
