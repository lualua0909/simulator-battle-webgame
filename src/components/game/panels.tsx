'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ConfigBundle } from '@/shared/schema';
import type { RoomState } from '@/shared/net';
import type { Side } from '@/game/sim/terrain';
import type { BattleResult } from '@/game/sim/world';
import type { BattleStats } from '@/game/render/engine';

export const SIDE_NAME: Record<Side, string> = { blue: 'Xanh', red: 'Đỏ' };

export function resultTitle(result: BattleResult, mySide?: Side): string {
  if (result.winner === 'draw') return 'HÒA!';
  if (mySide) return result.winner === mySide ? 'CHIẾN THẮNG!' : 'THẤT BẠI!';
  return `${SIDE_NAME[result.winner].toUpperCase()} THẮNG!`;
}

/** Letterbox bars + skip button while a cinematic owns the camera. */
export function CinematicBars({ title, winner, onSkip }: { title?: string; winner?: Side | 'draw'; onSkip(): void }) {
  const color = winner === 'blue' ? 'text-blue-team' : winner === 'red' ? 'text-red-team' : 'text-ink';
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

export function SetupPanel(props: {
  bundle: ConfigBundle;
  mode: 'ai' | 'local';
  mapId: string;
  setMapId(id: string): void;
  budget: number;
  setBudget(v: number): void;
  botId: string;
  setBotId(id: string): void;
  blind: boolean;
  setBlind(v: boolean): void;
  onStart(): void;
}) {
  const { bundle, mode } = props;
  return (
    <div className="panel pointer-events-auto mx-auto flex max-h-[88vh] w-[min(760px,94vw)] flex-col gap-3 overflow-y-auto p-4">
      <h2 className="font-display text-2xl">{mode === 'ai' ? 'Đấu với máy' : '2 người 1 máy'}</h2>
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
                {m.size}m {m.river.enabled ? '· có sông' : ''}
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-extrabold uppercase opacity-70">Ngân sách</h3>
        <input type="range" min={300} max={30000} step={100} value={props.budget} onChange={(e) => props.setBudget(Number(e.target.value))} className="flex-1" />
        <input type="number" min={100} step={100} value={props.budget} onChange={(e) => props.setBudget(Math.max(100, Number(e.target.value) || 0))} className="field w-28" />
      </section>
      {mode === 'ai' ? (
        <section>
          <h3 className="mb-1 text-sm font-extrabold uppercase opacity-70">Đối thủ</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {bundle.bots.map((b) => (
              <button key={b.id} onClick={() => props.setBotId(b.id)} className={`rounded-xl border-2 p-2 text-left ${props.botId === b.id ? 'border-ink bg-gold' : 'border-ink/30 bg-white'}`}>
                <div className="flex items-center justify-between font-bold">
                  {b.name}
                  <span className="text-amber-600">{'★'.repeat(b.difficulty)}</span>
                </div>
                <div className="text-xs opacity-75">{b.description}</div>
                <div className="mt-1 flex gap-1 text-[10px] font-bold uppercase">
                  <span className="rounded bg-ink/10 px-1">×{b.budgetMultiplier} tiền</span>
                  {b.reactive && <span className="rounded bg-red-team/15 px-1 text-red-team">xem quân bạn</span>}
                </div>
              </button>
            ))}
          </div>
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
      <div className="panel pointer-events-auto mx-auto flex w-[min(460px,94vw)] flex-col gap-3 p-4">
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
    <div className="panel pointer-events-auto mx-auto flex w-[min(460px,94vw)] flex-col gap-3 p-4">
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

export function RoomBar(props: { bundle: ConfigBundle; room: RoomState; mySide: Side; onSettings(mapId: string, budget: number): void }) {
  const { room, mySide, bundle } = props;
  const host = mySide === 'blue';
  const link = typeof window !== 'undefined' ? `${window.location.origin}/play?mode=online&room=${room.code}` : '';
  const [copied, setCopied] = useState(false);
  return (
    <div className="panel pointer-events-auto flex flex-col gap-2 p-2 text-sm">
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
      {(['blue', 'red'] as const).map((s) => {
        const p = room.players[s];
        return (
          <div key={s} className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full ${s === 'blue' ? 'bg-blue-team' : 'bg-red-team'}`} />
            <span className="font-bold">{p ? p.name : '— đang chờ —'}</span>
            {s === mySide && <span className="text-xs opacity-60">(bạn)</span>}
            {p && !p.connected && <span className="text-xs text-red-team">mất kết nối</span>}
            {p?.ready && <span className="ml-auto rounded bg-green-600 px-1.5 text-xs font-bold text-white">SẴN SÀNG</span>}
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <select className="field" disabled={!host} value={room.mapId} onChange={(e) => props.onSettings(e.target.value, bundle.maps.find((m) => m.id === e.target.value)?.budget ?? room.budget)}>
          {bundle.maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input className="field w-24" type="number" step={100} disabled={!host} value={room.budget} onChange={(e) => props.onSettings(room.mapId, Math.max(100, Number(e.target.value) || 100))} />
      </div>
      {!host && <p className="text-xs opacity-60">Chủ phòng (Xanh) chọn bản đồ và ngân sách.</p>}
    </div>
  );
}

export function BattleHud(props: { stats: BattleStats; total: Record<Side, number>; speed: number; paused: boolean; onSpeed(s: number): void; onPause(): void; onStop(): void; stopLabel: string }) {
  const { stats, total } = props;
  const mm = Math.floor(stats.time / 60);
  const ss = Math.floor(stats.time % 60)
    .toString()
    .padStart(2, '0');
  return (
    <>
      <div className="panel pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-3 px-4 py-2">
        <TeamBar side="blue" alive={stats.blue} total={total.blue} />
        <span className="font-display text-lg tabular-nums">
          {mm}:{ss}
        </span>
        <TeamBar side="red" alive={stats.red} total={total.red} />
      </div>
      <div className="panel pointer-events-auto absolute bottom-3 right-3 flex items-center gap-1 p-2">
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
      <div className="pointer-events-none absolute bottom-3 left-3 hidden max-w-56 text-[11px] font-bold leading-tight text-ink/80 drop-shadow lg:block">
        Chuột trái/giữa kéo: kéo bản đồ · Chuột phải kéo: xoay/nghiêng · Lăn/pinch: zoom theo con trỏ · WASD/QE
      </div>
    </>
  );
}

function TeamBar({ side, alive, total }: { side: Side; alive: number; total: number }) {
  const pct = total > 0 ? (alive / total) * 100 : 0;
  return (
    <div className={`flex w-40 items-center gap-2 ${side === 'red' ? 'flex-row-reverse' : ''}`}>
      <span className={`font-display text-lg ${side === 'blue' ? 'text-blue-team' : 'text-red-team'}`}>{alive}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full border-2 border-ink bg-white">
        <div className={`h-full ${side === 'blue' ? 'bg-blue-team' : 'ml-auto bg-red-team'}`} style={{ width: `${pct}%`, marginLeft: side === 'red' ? 'auto' : undefined }} />
      </div>
    </div>
  );
}

export function ResultModal(props: { result: BattleResult; mySide?: Side; onRematch(): void; onEdit(): void; rematchLabel?: string }) {
  const { result } = props;
  const title = resultTitle(result, props.mySide);
  const color = result.winner === 'blue' ? 'text-blue-team' : result.winner === 'red' ? 'text-red-team' : 'text-ink';
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-ink/25">
      <div className="panel flex w-[min(420px,92vw)] flex-col items-center gap-3 p-6 text-center">
        <div className={`font-display text-4xl ${color}`}>{title}</div>
        <p className="text-sm opacity-80">
          {result.reason === 'timeout' ? 'Hết giờ — phân định theo giá trị quân còn lại.' : 'Một bên đã bị tiêu diệt hoàn toàn.'}
          <br />
          Còn sống: <b className="text-blue-team">{result.survivors.blue}</b> xanh · <b className="text-red-team">{result.survivors.red}</b> đỏ · {(result.tick / 30).toFixed(0)} giây
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn btn-gold" onClick={props.onRematch}>
            {props.rematchLabel ?? 'Đấu lại'}
          </button>
          <button className="btn" onClick={props.onEdit}>
            Sửa đội hình
          </button>
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
