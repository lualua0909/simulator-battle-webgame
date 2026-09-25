'use client';

import { ArrowLeft, ArrowRight, Castle, ChevronRight, Flame, Star, Swords, Timer, User } from 'lucide-react';
import Link from 'next/link';
import GameControlIcon from '@/components/ui/GameControlIcon';
import { useEffect, useState, type ReactNode } from 'react';
import type { BotDef, ConfigBundle } from '@/shared/schema';
import type { RoomSettings, RoomState } from '@/shared/net';
import { playerLevel, type PlayerState } from '@/shared/economy';
import { ALL_SIDES, type Side } from '@/game/sim/terrain';
import type { BattleResult } from '@/game/sim/world';
import type { BattleStats, ViewState } from '@/game/render/engine';
import { followsUnit, type ViewMode } from '@/game/render/unitView';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export const SIDE_NAME: Record<Side, string> = { blue: 'Blue', red: 'Red', green: 'Green', yellow: 'Yellow' };
export function sideName(side: Side, locale?: string): string {
  if (locale === 'vi') return { blue: 'Xanh', red: 'Đỏ', green: 'Lục', yellow: 'Vàng' }[side];
  return SIDE_NAME[side];
}
export const SIDE_BG: Record<Side, string> = { blue: 'bg-blue-team', red: 'bg-red-team', green: 'bg-green-team', yellow: 'bg-yellow-team' };
export const SIDE_TEXT: Record<Side, string> = { blue: 'text-blue-team', red: 'text-red-team', green: 'text-green-team', yellow: 'text-yellow-team' };

/** Mode picker value: open battle, or siege with the given side defending. */
export type ModeChoice = 'battle' | Side;

export function ModePicker(props: { mode: 'bot' | 'local' | 'online'; value: ModeChoice; onChange(v: ModeChoice): void; disabled?: boolean }) {
  const { t } = useLanguage();
  const options: Array<{ value: ModeChoice; label: ReactNode; hint: string }> =
    props.mode === 'bot'
      ? [
          { value: 'battle', label: <><Swords /> {t('panels.battle')}</>, hint: t('panels.battleHint') },
          { value: 'blue', label: <><Castle /> {t('panels.defendYou')}</>, hint: t('panels.defendYouHint') },
          { value: 'red', label: <><Flame /> {t('panels.attackYou')}</>, hint: t('panels.attackYouHint') },
        ]
      : [
          { value: 'battle', label: <><Swords /> {t('panels.battle')}</>, hint: t('panels.battleHint') },
          { value: 'blue', label: <><Castle /> {t('panels.defendBlue')}</>, hint: t('panels.defendBlueHint') },
          { value: 'red', label: <><Castle /> {t('panels.defendRed')}</>, hint: t('panels.defendRedHint') },
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

export function resultTitle(result: BattleResult, mySide?: Side, locale: string = 'en'): string {
  if (result.winner === 'draw') return locale === 'vi' ? 'HÒA!' : 'DRAW!';
  if (mySide) {
    if (result.winner === mySide) return locale === 'vi' ? 'CHIẾN THẮNG!' : 'VICTORY!';
    return locale === 'vi' ? 'THẤT BẠI!' : 'DEFEAT!';
  }
  const name = sideName(result.winner, locale).toUpperCase();
  return locale === 'vi' ? `${name} THẮNG!` : `${name} WINS!`;
}

/** Letterbox bars + skip button while a cinematic owns the camera. */
export function CinematicBars({ title, winner, onSkip }: { title?: string; winner?: Side | 'draw'; onSkip(): void }) {
  const { t } = useLanguage();
  const color = winner && winner !== 'draw' ? SIDE_TEXT[winner] : 'text-ink';
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="cine-bar absolute inset-x-0 top-0 h-[9vh] origin-top bg-black/85" />
      <div className="cine-bar absolute inset-x-0 bottom-0 flex h-[9vh] origin-bottom items-center justify-end bg-black/85 px-4">
        <button className="pointer-events-auto rounded-lg border-2 border-white/70 px-3 py-1 text-sm font-bold text-white hover:bg-white/15" onClick={onSkip}>
          {t('panels.skip')} <ChevronRight />
        </button>
      </div>
      {title && <div className={`cine-title absolute inset-x-0 top-[13vh] px-4 text-center font-display text-3xl break-words sm:text-6xl ${color}`}>{title}</div>}
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
  /** Signed-out players fight at level 1. */
  player: PlayerState | null;
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
  const { t, locale, mapName, botName } = useLanguage();
  const modeTitle = mode === 'bot' ? t('modes.botTitle') : t('modes.localTitle');
  const lv = playerLevel(props.player?.xp ?? 0, bundle.settings.economy);
  return (
    <div className="panel glass-popup pointer-events-auto m-auto flex max-h-full w-[min(760px,94vw)] flex-col gap-2 overflow-y-auto overscroll-contain p-3 touch-pan-y sm:max-h-[88vh] sm:gap-3 sm:p-4">
      <h2 className="font-display text-2xl">{modeTitle}</h2>
      <section>
        <h3 className="mb-1 text-sm font-extrabold uppercase opacity-70">{locale === 'vi' ? 'Chế độ' : 'Mode'}</h3>
        <ModePicker mode={mode} value={props.choice} onChange={props.setChoice} />
        {props.choice !== 'battle' && <p className="mt-1 text-xs opacity-70">{locale === 'vi' ? 'Phe thủ chỉ đứng trong vùng của mình, cần 1 Nhà chính. Phe công phá Nhà chính để thắng; hết giờ thì phe thủ thắng.' : 'Defenders stay in their zone and need 1 Keep. Attackers win by destroying the Keep; defenders win on timeout.'}</p>}
      </section>
      <section>
        <h3 className="mb-1 text-sm font-extrabold uppercase opacity-70">{locale === 'vi' ? 'Bản đồ' : 'Map'}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {bundle.maps.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                props.setMapId(m.id);
              }}
              className={`rounded-xl border-2 p-2 text-left ${props.mapId === m.id ? 'border-ink bg-gold' : 'border-ink/30 bg-white'}`}
            >
              <div className="h-8 rounded-md" style={{ background: `linear-gradient(180deg, ${m.skyTop}, ${m.skyBottom} 55%, ${m.grassColor} 56%, ${m.dirtColor})` }} />
              <div className="mt-1 font-bold">{mapName(m.id, m.name)}</div>
              <div className="text-xs opacity-70">
                {m.size}m {m.river.enabled ? (locale === 'vi' ? '· có sông' : '· river') : ''} {m.defenseDepth > 0 && <>· <Castle /></>}
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="flex items-center gap-2 sm:gap-3">
        <span className="min-w-0 flex-1 text-xs font-bold opacity-70">
          {t('game.level')} {lv.level}
          {lv.need > 0 && ` · ${lv.into}/${lv.need} XP`}
        </span>
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
          <h3 className="mb-1 text-sm font-extrabold uppercase opacity-70">{t('game.opponent')}</h3>
          <div className="grid grid-cols-2 gap-1 min-[420px]:grid-cols-4 sm:gap-2">
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
                  <span title={botName(b.id, b.name)} className={`max-w-full truncate px-1 text-xs leading-tight sm:text-base ${active ? '' : 'opacity-70 group-hover:opacity-100'}`}>{botName(b.id, b.name)}</span>
                  <span className={`h-1 w-8 rounded-full transition-colors sm:w-10 ${active ? 'bg-gold' : 'bg-transparent group-hover:bg-ink/20'}`} />
                </button>
              );
            })}
          </div>
          {props.choice !== 'battle' && <p className="mt-1 text-xs opacity-70">{locale === 'vi' ? 'Thủ/công thành chỉ đấu 1 bot.' : 'Siege battles use 1 bot.'}</p>}
        </section>
      ) : (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={props.blind} onChange={(e) => props.setBlind(e.target.checked)} />
          {locale === 'vi' ? 'Xếp quân bí mật (không thấy quân đối phương khi đặt)' : 'Secret deployment (hide enemy army while placing)'}
        </label>
      )}
      <div className="flex justify-between">
        <Link href="/" className="btn">
          <ArrowLeft /> Menu
        </Link>
        <button className="btn btn-gold text-lg" onClick={props.onStart}>
          {locale === 'vi' ? 'Vào xếp quân' : 'Deploy'} <ArrowRight />
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
          <User /> Đăng nhập
        </button>
        <Link href="/" className="text-sm underline">
          <ArrowLeft /> Menu
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
        <ArrowLeft /> Menu
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
  const current: RoomSettings = { mapId: room.mapId, useStars: room.useStars, defense: room.defense };
  const set = (patch: Partial<RoomSettings>) => props.onSettings({ ...current, ...patch });
  const host = mySide === 'blue';
  const link = typeof window !== 'undefined' ? `${window.location.origin}/play?mode=online&room=${room.code}` : '';
  const [copied, setCopied] = useState(false);
  const secondsLeft = useCountdown(room.deadline);
  /** Siege is 2-side only; an open room can seat up to 4. */
  const slots = room.defense !== null ? (['blue', 'red'] as const) : ALL_SIDES;
  return (
    <div className="panel pointer-events-auto flex max-h-[22vh] w-44 max-w-[calc(100vw-1.5rem)] flex-col gap-2 overflow-y-auto overscroll-contain p-2 text-sm sm:max-h-[50vh] sm:w-52 md:max-h-none md:overflow-visible">
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
            {p && <span className="text-xs tabular-nums opacity-60" title="Ngân sách theo cấp">{p.budget}</span>}
            {p && !p.connected && <span className="text-xs text-red-team">mất kết nối</span>}
            {p?.ready && <span className="ml-auto rounded bg-green-600 px-1.5 text-xs font-bold text-white">SẴN SÀNG</span>}
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <select className="field" disabled={!host} value={room.mapId} onChange={(e) => set({ mapId: e.target.value })}>
          {bundle.maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <select className="field" disabled={!host} value={room.defense ?? 'battle'} onChange={(e) => set({ defense: e.target.value === 'battle' ? null : (e.target.value as Side) })}>
        <option value="battle">Đại chiến</option>
        <option value="blue">Thủ thành: Xanh thủ</option>
        <option value="red">Thủ thành: Đỏ thủ</option>
      </select>
      <label className="flex items-center gap-2" title="Lính đã nâng sao được cộng máu và sát thương theo sao của từng người">
        <input type="checkbox" disabled={!host} checked={room.useStars} onChange={(e) => set({ useStars: e.target.checked })} />
        <Star /> Tính sao nâng cấp của lính
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
        className="btn btn-icon"
        onClick={() => setOpen((o) => !o)}
        title="Hướng dẫn điều khiển"
        aria-label="Hướng dẫn điều khiển"
      >
        <GameControlIcon name="help" />
      </button>
      {open && <div className="panel absolute bottom-9 left-0 z-10 w-60 max-w-[calc(100vw-2rem)] break-words p-2 text-xs leading-tight">{text}</div>}
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
  /** Speed and pause are omitted online: every client simulates on its own clock, so both stay locked. */
  onSpeed?(s: number): void;
  onPause?(): void;
  onStop(): void;
  stopLabel: string;
  timeLimit: number;
  defense: Side | null;
  view: ViewState;
  onView(mode: ViewMode): void;
  onNextUnit(): void;
  /** Shown only on a WebXR headset (Quest Browser). */
  onVR?(): void;
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
        className="panel pointer-events-auto absolute left-1/2 top-2 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto overscroll-contain whitespace-nowrap px-2.5 py-1.5 [scrollbar-width:none] sm:top-3 sm:gap-2 sm:px-3.5 sm:py-1.5 [&::-webkit-scrollbar]:hidden"
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
          <Timer /> {mm}:{ss}
          {props.defense && (
            <span className="text-[11px] leading-none" title={`Phe ${SIDE_NAME[props.defense]} thủ`}>
              <Castle />
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
      <div className="battle-controls panel pointer-events-auto absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-1/2 flex max-h-[28vh] max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 overflow-y-auto overscroll-contain p-1 sm:bottom-3 sm:max-h-none sm:overflow-visible">
        <HelpHint text="Chuột trái/giữa kéo: kéo bản đồ · Chuột phải kéo: xoay/nghiêng · Lăn/pinch: zoom theo con trỏ · WASD/QE · V: đổi góc nhìn · N: lính kế · Bấm vào lính để theo lính đó" />
        {VIEW_BUTTONS.map((b) => (
          <button key={b.mode} className={`btn btn-icon ${props.view.mode === b.mode ? 'btn-gold' : ''}`} onClick={() => props.onView(b.mode)} title={b.title} aria-label={b.label}>
            <GameControlIcon name={b.mode} />
          </button>
        ))}
        {followsUnit(props.view.mode) && (
          <button className="btn btn-icon" onClick={props.onNextUnit} title={`Theo lính kế tiếp (N)${props.view.unit ? ` · đang theo: ${props.view.unit}` : ''}`} aria-label="Lính kế">
            <GameControlIcon name="next" />
          </button>
        )}
        {props.onVR && (
          <button className={`btn btn-icon ${props.view.vr ? 'btn-gold' : ''}`} onClick={props.onVR} title={props.view.vr ? 'Thoát VR' : 'Chơi bằng kính VR (Quest)'} aria-label="VR">
            <GameControlIcon name="vr" />
          </button>
        )}
        <div className="mx-0.5 h-6 w-px shrink-0 bg-ink/15" />
        <button className={`btn btn-icon ${props.muted ? 'btn-gold' : ''}`} onClick={props.onMute} title="Bật/tắt âm thanh">
          <GameControlIcon name={props.muted ? 'muted' : 'sound'} />
        </button>
        {props.onPause && (
          <button className={`btn btn-icon ${props.paused ? 'btn-gold' : ''}`} onClick={props.onPause} title="Space">
            <GameControlIcon name={props.paused ? 'play' : 'pause'} />
          </button>
        )}
        {props.onSpeed &&
          [1, 2].map((s, i) => (
            <button key={s} className={`btn btn-icon text-xs ${props.speed === s ? 'btn-gold' : ''}`} onClick={() => props.onSpeed?.(s)} title={`${s}× · Phím ${i + 1}`}>
              {s}×
            </button>
          ))}
        <div className="mx-0.5 h-6 w-px shrink-0 bg-ink/15" />
        <button className="btn btn-icon btn-red" onClick={props.onStop} title={props.stopLabel} aria-label={props.stopLabel}>
          <GameControlIcon name="stop" />
        </button>
      </div>
    </>
  );
}

const VIEW_BUTTONS: { mode: ViewMode; label: string; title: string }[] = [
  { mode: 'overview', label: 'Toàn cảnh', title: 'Toàn cảnh (V)' },
  { mode: 'side', label: 'Nhìn ngang', title: 'Nhìn ngang: địch bên trái, quân ta bên phải (V)' },
  { mode: 'third', label: 'Sau lưng', title: 'Góc nhìn thứ 3: đứng sau lưng lính (V)' },
  { mode: 'first', label: 'Mắt lính', title: 'Góc nhìn thứ 1: nhìn bằng mắt lính (V)' },
  { mode: 'second', label: 'Trước mặt', title: 'Góc nhìn thứ 2: đứng trước mặt lính, nhìn nó lao tới (V)' },
];

function TeamBar({ side, alive, total, flip }: { side: Side; alive: number; total: number; flip: boolean }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (alive / total) * 100)) : 0;
  return (
    <div className={`flex shrink-0 items-center gap-1 sm:gap-1.5 ${flip ? 'flex-row-reverse' : ''}`} title={`${SIDE_NAME[side]}: còn ${alive}/${total}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ring-1 ring-ink/60 ${SIDE_BG[side]}`} />
      <span className={`font-display tabular-nums sm:text-lg ${SIDE_TEXT[side]}`}>{alive}</span>
      <div className="h-2.5 w-12 overflow-hidden rounded-full border border-ink/80 bg-black/10 sm:h-3 sm:w-20 lg:w-24">
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
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center overflow-y-auto bg-ink/45 p-3 overscroll-contain">
      <div className="panel flex max-h-[92dvh] w-[min(420px,92vw)] flex-col items-center gap-3 overflow-y-auto overscroll-contain p-6 text-center">
        <div className={`result-title font-display text-3xl break-words sm:text-4xl ${color}`}>{title}</div>
        <p className="result-description text-sm">
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
          Tôi là người chơi 2 <ArrowRight />
        </button>
      </div>
    </div>
  );
}
