'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BotDef, ConfigBundle } from '@/shared/schema';
import type { BattleStart } from '@/shared/net';
import { generateBotArmy } from '@/game/bot/generate';
import { useOnline } from '@/game/net/client';
import { BattleEngine, type BattleStats, type CinematicKind, type PointerInfo } from '@/game/render/engine';
import { unitThumbnails } from '@/game/render/thumbnails';
import { armyCost, type Armies, type Placement } from '@/game/sim/army';
import type { Side } from '@/game/sim/terrain';
import type { BattleResult } from '@/game/sim/world';
import { useConfig } from '@/game/useConfig';
import UnitPalette from './UnitPalette';
import { BattleHud, CinematicBars, Handoff, OnlineLobby, ResultModal, resultTitle, RoomBar, SetupPanel, SIDE_NAME } from './panels';

export type Mode = 'ai' | 'local' | 'online';
type Phase = 'setup' | 'lobby' | 'deploy' | 'handoff' | 'battle' | 'result';

const EMPTY: Armies = { blue: [], red: [] };
const randomSeed = () => 1 + Math.floor(Math.random() * (2 ** 31 - 2));

const RANDOM_FILL: BotDef = {
  id: 'random-fill',
  name: 'Ngẫu nhiên',
  description: '',
  difficulty: 3,
  budgetMultiplier: 1,
  strategy: 'balanced',
  factionIds: [],
  reactive: false,
  formation: 'line',
  randomness: 0.6,
  maxUnits: 500,
};

export default function GameClient({ mode, initialRoom }: { mode: Mode; initialRoom?: string }) {
  const { bundle, error } = useConfig();
  if (error) return <p className="p-6 text-red-700">Không tải được cấu hình game: {error}</p>;
  return <Game mode={mode} initialRoom={initialRoom} bundle={bundle} />;
}

function Game({ mode, initialRoom, bundle }: { mode: Mode; initialRoom?: string; bundle: ConfigBundle | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<BattleEngine | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [phase, setPhase] = useState<Phase>(mode === 'online' ? 'lobby' : 'setup');
  const [mapId, setMapId] = useState('');
  const [budget, setBudget] = useState(3000);
  const [botId, setBotId] = useState('');
  const [blind, setBlind] = useState(true);
  const [armies, setArmiesState] = useState<Armies>(EMPTY);
  const armiesRef = useRef<Armies>(EMPTY);
  const [side, setSide] = useState<Side>('blue');
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<'place' | 'erase'>('place');
  const [result, setResult] = useState<BattleResult | null>(null);
  const [stats, setStats] = useState<BattleStats>({ blue: 0, red: 0, time: 0 });
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [desync, setDesync] = useState(false);
  const [cine, setCine] = useState<CinematicKind | null>(null);
  const cineRef = useRef<CinematicKind | null>(null);
  /** Set on a fresh entry into deployment (not a return from battle) → establishing flight. */
  const introPending = useRef(false);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  const setArmies = useCallback((next: Armies) => {
    armiesRef.current = next;
    setArmiesState(next);
  }, []);

  /** Deployment undo stack (Ctrl/⌘+Z): one entry per click, drag, fill or clear. */
  const history = useRef<Armies[]>([]);
  const snapshot = useCallback(() => {
    history.current.push(armiesRef.current);
    if (history.current.length > 100) history.current.shift();
  }, []);

  // ------------------------------------------------------------------ online
  const onStartRef = useRef<(s: BattleStart) => void>(() => {});
  const net = useOnline(mode === 'online', {
    onStart: (s) => onStartRef.current(s),
    onDesync: () => setDesync(true),
  });

  // ------------------------------------------------------------------ bootstrap
  useEffect(() => {
    if (!bundle) return;
    setMapId((m) => m || bundle.maps[0]?.id || '');
    setBudget(bundle.maps[0]?.budget ?? 3000);
    setBotId((b) => b || bundle.bots[1]?.id || bundle.bots[0]?.id || '');
    setSelected((s) => s ?? [...bundle.units].sort((a, b) => a.cost - b.cost)[0]?.id ?? null);
    void unitThumbnails(bundle).then(setThumbs);
  }, [bundle]);

  const resultRef = useRef<(r: BattleResult) => void>(() => {});
  const pointerRef = useRef<(p: PointerInfo) => void>(() => {});
  const checksumRef = useRef<(t: number, h: number) => void>(() => {});

  useEffect(() => {
    if (!bundle || !hostRef.current) return;
    const e = new BattleEngine(hostRef.current, bundle, {
      onPointer: (p) => pointerRef.current(p),
      onResult: (r) => resultRef.current(r),
      onChecksum: (t, h) => checksumRef.current(t, h),
      onStats: setStats,
      onCinematic: (k) => {
        cineRef.current = k;
        setCine(k);
      },
    });
    setEngine(e);
    (window as unknown as { __engine?: BattleEngine }).__engine = e;
    return () => {
      e.dispose();
      setEngine(null);
    };
  }, [bundle]);

  // online room drives map + budget
  useEffect(() => {
    if (mode !== 'online' || !net.room) return;
    setMapId(net.room.mapId);
    setBudget(net.room.budget);
  }, [mode, net.room?.mapId, net.room?.budget]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!engine || !mapId) return;
    engine.loadMap(mapId);
    setArmies(EMPTY);
    setMapVersion((v) => v + 1);
  }, [engine, mapId, setArmies]);

  // deployment preview
  useEffect(() => {
    if (!engine || !engine.terrain || phase === 'battle' || phase === 'result') return;
    engine.setArmies(armies);
  }, [engine, armies, phase, mapVersion]);

  const units = useMemo(() => new Map((bundle?.units ?? []).map((u) => [u.id, u])), [bundle]);
  const maxUnits = bundle?.settings.maxUnitsPerSide ?? 150;
  const mySide: Side = mode === 'online' ? net.seat?.side ?? 'blue' : side;
  const myArmy = armies[mySide];
  const spent = bundle ? armyCost(bundle, myArmy) : 0;
  const me = mode === 'online' && net.seat ? net.room?.players[net.seat.side] : undefined;
  const locked = mode === 'online' && !!me?.ready;

  const canPlace = useCallback(
    (x: number, z: number): boolean => {
      const t = engine?.terrain;
      const u = selected ? units.get(selected) : undefined;
      if (!t || !u || !bundle) return false;
      const army = armiesRef.current[mySide];
      if (!t.inZone(mySide, x, z) || army.length >= maxUnits) return false;
      if (armyCost(bundle, army) + u.cost > budget) return false;
      for (const p of army) {
        const other = units.get(p.unitId);
        const min = (u.radius + (other?.radius ?? 0.4)) * 0.9;
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < min * min) return false;
      }
      return true;
    },
    [engine, selected, units, bundle, mySide, maxUnits, budget],
  );

  const place = useCallback(
    (x: number, z: number): boolean => {
      if (!selected || !canPlace(x, z)) return false;
      const cur = armiesRef.current;
      setArmies({ ...cur, [mySide]: [...cur[mySide], { unitId: selected, x, z }] });
      return true;
    },
    [selected, canPlace, mySide, setArmies],
  );

  const erase = useCallback(
    (x: number, z: number) => {
      const cur = armiesRef.current;
      let best = -1;
      let bestD = Infinity;
      cur[mySide].forEach((p, i) => {
        const r = Math.max(1.2, (units.get(p.unitId)?.radius ?? 0.5) + 0.6);
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < r * r && d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) setArmies({ ...cur, [mySide]: cur[mySide].filter((_, i) => i !== best) });
    },
    [mySide, units, setArmies],
  );

  const paint = useRef<{ active: boolean; erase: boolean; x: number; z: number }>({ active: false, erase: false, x: 0, z: 0 });
  pointerRef.current = (p: PointerInfo) => {
    if (phase !== 'deploy' || locked) return;
    if (p.type === 'down' && p.button === 0 && p.hit) {
      const del = tool === 'erase' || p.ctrl;
      paint.current = { active: true, erase: del, x: p.x, z: p.z };
      snapshot();
      if (del) erase(p.x, p.z);
      else if (!place(p.x, p.z) && engine?.terrain && !engine.terrain.inZone(mySide, p.x, p.z)) flash(`Chỉ được đặt trong vùng phe ${SIDE_NAME[mySide]}`);
    } else if (p.type === 'move' && paint.current.active && p.hit && (p.shift || paint.current.erase)) {
      const u = selected ? units.get(selected) : undefined;
      const spacing = Math.max(1, (u?.radius ?? 0.5) * 2.2);
      if ((p.x - paint.current.x) ** 2 + (p.z - paint.current.z) ** 2 >= spacing * spacing) {
        paint.current.x = p.x;
        paint.current.z = p.z;
        if (paint.current.erase) erase(p.x, p.z);
        else place(p.x, p.z);
      }
    } else if (p.type === 'up' && paint.current.active) {
      paint.current.active = false;
      // Drop the entry if the stroke changed nothing.
      const h = history.current;
      if (h[h.length - 1] === armiesRef.current) h.pop();
    }
  };

  const undo = () => {
    const prev = history.current.pop();
    if (prev) setArmies(prev);
  };

  // Undo history belongs to one side on one map.
  useEffect(() => {
    history.current = [];
  }, [mySide, mapVersion, phase]);

  // engine presentation per phase
  useEffect(() => {
    if (!engine) return;
    if (phase === 'deploy') {
      engine.showZones([mySide]);
      engine.setHidden(mode === 'local' && blind ? (mySide === 'blue' ? 'red' : 'blue') : null);
      engine.setGhost(tool === 'place' && !locked ? selected : null, mySide, canPlace);
    } else if (phase === 'setup' || phase === 'lobby') {
      engine.viewSide('blue');
      engine.showZones(['blue', 'red']);
      engine.setGhost(null);
      engine.setHidden(null);
    } else {
      engine.showZones([]);
      engine.setGhost(null);
    }
  }, [engine, phase, mySide, mode, blind, tool, selected, locked, canPlace, mapVersion]);

  // Re-frame the camera only when the viewing side or map changes (not on every tool change).
  // A fresh entry into deployment plays the establishing flight instead — restarted if the
  // side or map changes under it (an online room syncing its map).
  useEffect(() => {
    if (!engine || phase !== 'deploy') return;
    if (introPending.current || cineRef.current === 'intro') {
      introPending.current = false;
      engine.playDeployIntro(mySide);
    } else engine.viewSide(mySide);
  }, [engine, phase, mySide, mapVersion]);

  // Left-drag pans the map whenever the left button is not placing units.
  useEffect(() => {
    if (engine) engine.rts.leftPan = phase !== 'deploy' || locked;
  }, [engine, phase, locked]);

  useEffect(() => engine?.setSpeed(speed), [engine, speed]);
  useEffect(() => engine?.setPaused(paused), [engine, paused]);

  // ------------------------------------------------------------------ flow
  const bot = bundle?.bots.find((b) => b.id === botId);

  const botArmy = useCallback(
    (enemy: Placement[]): Placement[] => {
      if (!bundle || !bot || !engine?.terrain) return [];
      return generateBotArmy({ bot, content: bundle, terrain: engine.terrain, side: 'red', budget: Math.round(budget * bot.budgetMultiplier), enemy, seed: randomSeed() });
    },
    [bundle, bot, engine, budget],
  );

  const startBattle = useCallback(
    (a: Armies, seed = randomSeed()) => {
      if (!engine) return;
      setArmies(a);
      setResult(null);
      setPaused(false);
      setDesync(false);
      engine.startBattle(a, seed);
      engine.playBattleIntro(mode === 'online' ? mySide : 'blue');
      setPhase('battle');
    },
    [engine, setArmies, mode, mySide],
  );

  resultRef.current = (r) => {
    if (mode === 'online') net.end(r.winner);
    setResult(r);
    const show = () => setPhase((p) => (p === 'battle' ? 'result' : p));
    const winner = r.winner;
    if (winner === 'draw') return void window.setTimeout(show, 1600);
    // Let the last fall land, then walk through the winners — unless the battle was left meanwhile.
    window.setTimeout(() => {
      if (engine?.sim?.result === r) engine.playVictory(winner, show);
    }, 900);
  };
  checksumRef.current = (tick, hash) => {
    if (mode === 'online') net.checksum(tick, hash);
  };
  onStartRef.current = (s) => {
    if (bundle && s.configVersion !== bundle.version) flash('Cảnh báo: cấu hình game khác máy chủ — hãy tải lại trang để đồng bộ.');
    if (engine && engine.map?.id !== s.mapId) {
      engine.loadMap(s.mapId);
      setMapVersion((v) => v + 1);
    }
    startBattle(s.armies, s.seed);
  };

  const enterDeploy = () => {
    setSide('blue');
    setResult(null);
    const next: Armies = { blue: [], red: [] };
    if (mode === 'ai' && bot && !bot.reactive) next.red = botArmy([]);
    setArmies(next);
    introPending.current = true;
    setPhase('deploy');
  };

  const primaryAction = async () => {
    if (!bundle) return;
    if (myArmy.length === 0) return flash('Hãy đặt ít nhất 1 lính');
    if (mode === 'ai') {
      const red = bot?.reactive ? botArmy(armiesRef.current.blue) : armiesRef.current.red;
      startBattle({ blue: armiesRef.current.blue, red });
    } else if (mode === 'local') {
      if (side === 'blue') setPhase('handoff');
      else startBattle(armiesRef.current);
    } else {
      if (locked) {
        net.unready();
        return;
      }
      setBusy(true);
      const res = await net.ready(myArmy);
      setBusy(false);
      if (!res.ok) flash(res.error);
    }
  };

  const fillRandom = () => {
    if (!bundle || !engine?.terrain) return;
    const army = generateBotArmy({ bot: { ...RANDOM_FILL, maxUnits: maxUnits }, content: bundle, terrain: engine.terrain, side: mySide, budget, seed: randomSeed() });
    snapshot();
    setArmies({ ...armiesRef.current, [mySide]: army });
  };

  const backToDeploy = () => {
    setResult(null);
    setPaused(false);
    if (mode === 'local') setSide('blue');
    engine?.setArmies(armiesRef.current);
    setPhase('deploy');
  };

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (cineRef.current) {
        // Any key (not a bare modifier) skips the cinematic.
        if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
          e.preventDefault();
          engine?.skipCinematic();
        }
        return;
      }
      if (e.code === 'Space' && phase === 'battle') {
        e.preventDefault();
        setPaused((p) => !p);
      }
      if (e.key === 'Escape' && phase === 'deploy') setTool('place');
      if (e.key.toLowerCase() === 'x' && phase === 'deploy') setTool((t) => (t === 'erase' ? 'place' : 'erase'));
      if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && phase === 'deploy' && !locked) {
        e.preventDefault();
        undo();
      }
      const speedKey = { '1': 0.25, '2': 1, '3': 2, '4': 4 }[e.key];
      if (speedKey && (phase === 'battle' || phase === 'result')) setSpeed(speedKey);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const totals = useMemo(() => ({ blue: armies.blue.length, red: armies.red.length }), [armies]);
  const resultSide: Side | undefined = mode === 'online' ? net.seat?.side : mode === 'ai' ? 'blue' : undefined;

  // ------------------------------------------------------------------ render
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#cfe3f2] select-none">
      <div ref={hostRef} className="absolute inset-0" />
      {!bundle && <div className="absolute inset-0 flex items-center justify-center font-display text-2xl">Đang tải…</div>}

      <div className="pointer-events-none absolute inset-0 flex flex-col p-3">
        {bundle && phase === 'setup' && mode !== 'online' && (
          <div className="my-auto">
            <SetupPanel bundle={bundle} mode={mode} mapId={mapId} setMapId={setMapId} budget={budget} setBudget={setBudget} botId={botId} setBotId={setBotId} blind={blind} setBlind={setBlind} onStart={enterDeploy} />
          </div>
        )}

        {bundle && phase === 'lobby' && (
          <div className="my-auto">
            <OnlineLobby
              connected={net.connected}
              initialCode={initialRoom}
              busy={busy}
              onCreate={async (name) => {
                setBusy(true);
                const r = await net.create(name);
                setBusy(false);
                if (!r.ok) return flash(r.error);
                window.history.replaceState(null, '', `/play?mode=online&room=${r.code}`);
                introPending.current = true;
                setPhase('deploy');
              }}
              onJoin={async (code, name) => {
                setBusy(true);
                const r = await net.join(code, name);
                setBusy(false);
                if (!r.ok) return flash(r.error);
                window.history.replaceState(null, '', `/play?mode=online&room=${r.code}`);
                introPending.current = true;
                setPhase('deploy');
              }}
            />
          </div>
        )}

        {bundle && phase === 'deploy' && !cine && (
          <>
            <div className="flex items-start gap-2">
              <div className="panel pointer-events-auto flex flex-wrap items-center gap-2 p-2">
                <Link href="/" className="btn px-2 py-1 text-sm">
                  ←
                </Link>
                <span className={`rounded-lg px-2 py-1 font-display text-white ${mySide === 'blue' ? 'bg-blue-team' : 'bg-red-team'}`}>Phe {SIDE_NAME[mySide]}</span>
                <div className="w-44">
                  <div className="flex justify-between text-xs font-bold">
                    <span>Ngân sách</span>
                    <span className={spent > budget ? 'text-red-team' : ''}>
                      {spent}/{budget}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full border-2 border-ink bg-white">
                    <div className="h-full bg-gold" style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }} />
                  </div>
                </div>
                <span className="text-xs font-bold">
                  {myArmy.length}/{maxUnits} lính
                </span>
                <button className={`btn px-2 py-1 text-sm ${tool === 'place' ? 'btn-gold' : ''}`} onClick={() => setTool('place')}>
                  ✚ Đặt
                </button>
                <button className={`btn px-2 py-1 text-sm ${tool === 'erase' ? 'btn-gold' : ''}`} onClick={() => setTool('erase')} title="X">
                  ✖ Xóa
                </button>
                <button className="btn px-2 py-1 text-sm" disabled={locked} onClick={fillRandom}>
                  🎲 Ngẫu nhiên
                </button>
                <button className="btn px-2 py-1 text-sm" disabled={locked} onClick={undo} title="Ctrl/⌘+Z">
                  ↶ Hoàn tác
                </button>
                <button
                  className="btn px-2 py-1 text-sm"
                  disabled={locked}
                  onClick={() => {
                    snapshot();
                    setArmies({ ...armiesRef.current, [mySide]: [] });
                  }}
                >
                  Xóa hết
                </button>
              </div>
              <div className="ml-auto flex flex-col items-end gap-2">
                <button className={`btn pointer-events-auto text-lg ${locked ? '' : 'btn-gold'}`} disabled={busy} onClick={() => void primaryAction()}>
                  {mode === 'ai' ? '⚔ Bắt đầu!' : mode === 'local' ? (side === 'blue' ? 'Xong → Người chơi 2' : '⚔ Bắt đầu!') : locked ? 'Hủy sẵn sàng' : '✔ Sẵn sàng'}
                </button>
                {mode === 'online' && net.room && net.seat && <RoomBar bundle={bundle} room={net.room} mySide={net.seat.side} onSettings={net.settings} />}
                {mode === 'ai' && bot && (
                  <div className="panel pointer-events-auto p-2 text-xs">
                    Đối thủ: <b>{bot.name}</b> · {bot.reactive ? 'sẽ chọn quân sau khi xem đội hình của bạn' : `${armies.red.length} lính (${armyCost(bundle, armies.red)})`}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-auto flex items-end gap-2">
              <div className="pointer-events-none hidden max-w-56 text-[11px] font-bold leading-tight text-ink/80 drop-shadow lg:block">
                Chuột trái: đặt · Shift+kéo: rải · Ctrl/⌥+click hoặc X: xóa · Ctrl/⌘+Z: hoàn tác · Chuột phải kéo: xoay/nghiêng · Chuột giữa hoặc Shift+chuột phải: kéo bản đồ · Lăn/pinch: zoom theo con trỏ · WASD/QE
              </div>
              <div className="flex-1">
                <UnitPalette bundle={bundle} thumbs={thumbs} selected={selected} onSelect={(id) => (setSelected(id), setTool('place'))} budgetLeft={budget - spent} />
              </div>
            </div>
          </>
        )}

        {bundle && (phase === 'battle' || phase === 'result') && !cine && (
          <BattleHud
            stats={stats}
            total={totals}
            speed={speed}
            paused={paused}
            onSpeed={setSpeed}
            onPause={() => setPaused((p) => !p)}
            onStop={backToDeploy}
            stopLabel={mode === 'online' ? 'Về xếp quân' : 'Dừng trận'}
          />
        )}
        {desync && phase === 'battle' && <div className="panel pointer-events-auto absolute left-1/2 top-20 -translate-x-1/2 px-3 py-1 text-sm text-red-team">Hai máy đang lệch trận (desync) — kết quả có thể khác nhau.</div>}
      </div>

      {phase === 'result' && result && (
        <ResultModal
          result={result}
          mySide={resultSide}
          onRematch={mode === 'online' ? backToDeploy : () => startBattle(armiesRef.current)}
          rematchLabel={mode === 'online' ? 'Trận mới' : 'Đấu lại'}
          onEdit={backToDeploy}
        />
      )}
      {phase === 'handoff' && (
        <Handoff
          onContinue={() => {
            setSide('red');
            introPending.current = true;
            setPhase('deploy');
          }}
        />
      )}
      {cine && (
        <CinematicBars
          title={cine === 'victory' && result ? resultTitle(result, resultSide) : undefined}
          winner={cine === 'victory' ? result?.winner : undefined}
          onSkip={() => engine?.skipCinematic()}
        />
      )}
      {toast && <div className="panel pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 px-4 py-2 font-bold">{toast}</div>}
    </div>
  );
}
