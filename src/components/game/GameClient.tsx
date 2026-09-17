'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isUnlocked } from '@/shared/economy';
import type { BotDef, ConfigBundle } from '@/shared/schema';
import { useAuth } from '@/components/auth/AuthProvider';
import PlayerHud from '@/components/player/PlayerHud';
import { usePlayer } from '@/components/player/PlayerProvider';
import type { ArmyStars, BattleStart } from '@/shared/net';
import { generateBotArmy } from '@/game/bot/generate';
import { generateSiegeDefense } from '@/game/bot/siege';
import { useOnline } from '@/game/net/client';
import { BattleEngine, type BattleStats, type CinematicKind, type PointerInfo } from '@/game/render/engine';
import { unitThumbnails } from '@/game/render/thumbnails';
import { armyCost, canField, cellKeyOf, gridCells, isGridStructure, overlapsGrid, sideBudget, snapToCell, type Armies, type Placement } from '@/game/sim/army';
import { wallCenter, wallIndex, type Side } from '@/game/sim/terrain';
import type { BattleResult } from '@/game/sim/world';
import { useConfig } from '@/game/useConfig';
import UnitPalette from './UnitPalette';
import { BattleHud, CinematicBars, Handoff, HelpHint, OnlineLobby, ResultModal, resultTitle, RoomBar, SetupPanel, SIDE_NAME, type ModeChoice } from './panels';

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
  /** Offline mode choice: open battle, or siege with that side defending. */
  const [choice, setChoice] = useState<ModeChoice>('battle');
  const [armies, setArmiesState] = useState<Armies>(EMPTY);
  const armiesRef = useRef<Armies>(EMPTY);
  const [side, setSide] = useState<Side>('blue');
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<'place' | 'erase'>('place');
  /** Unit currently being dragged from the palette onto the map (null when not dragging). */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [stats, setStats] = useState<BattleStats>({ blue: 0, red: 0, time: 0 });
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
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
  const { user, loading: authLoading, openAuth } = useAuth();
  const { player } = usePlayer();
  const onStartRef = useRef<(s: BattleStart) => void>(() => {});
  /** A `battle:result` that arrives while still in `battle` phase means the other side surrendered: force the transition. */
  const endOnlineRef = useRef<(winner: Side | 'draw') => void>(() => {});
  const net = useOnline(mode === 'online' ? user?.uid ?? null : null, {
    onStart: (s) => onStartRef.current(s),
    onDesync: () => setDesync(true),
    onResult: (res) => {
      flash(res.ok ? 'Máy chủ đã xác nhận và lưu kết quả trận.' : `Kết quả không được lưu: ${res.error}`);
      if (res.ok) endOnlineRef.current(res.winner);
    },
  });

  useEffect(() => {
    if (net.error) flash(net.error);
  }, [net.error, flash]);

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

  // Lost the seat (signed out, or the room is gone after a reconnect) → back to the lobby.
  useEffect(() => {
    if (mode === 'online' && !net.seat && phase === 'deploy') setPhase('lobby');
  }, [mode, net.seat, phase]);

  /** Siege mode: the defending side (null = open battle). */
  const defense: Side | null = mode === 'online' ? net.room?.defense ?? null : choice === 'battle' ? null : choice;

  useEffect(() => {
    if (!engine || !mapId) return;
    engine.loadMap(mapId, defense);
    setArmies(EMPTY);
    setMapVersion((v) => v + 1);
  }, [engine, mapId, defense, setArmies]);

  // deployment preview
  useEffect(() => {
    if (!engine || !engine.terrain || phase === 'battle' || phase === 'result') return;
    engine.setArmies(armies);
  }, [engine, armies, phase, mapVersion]);

  const units = useMemo(() => new Map((bundle?.units ?? []).map((u) => [u.id, u])), [bundle]);
  /** Units this player may field: free ones, plus the ones unlocked with coins. */
  const owned = useMemo(() => (bundle?.units ?? []).filter((u) => isUnlocked(u, player)), [bundle, player]);

  const maxUnits = bundle?.settings.maxUnitsPerSide ?? 150;
  const mySide: Side = mode === 'online' ? net.seat?.side ?? 'blue' : side;
  const myArmy = armies[mySide];
  const spent = bundle ? armyCost(bundle, myArmy) : 0;
  const myBudget = bundle ? sideBudget(bundle.settings, budget, mySide, defense) : budget;
  const wallBlocks = myArmy.filter((p) => units.get(p.unitId)?.structure === 'wall').length;

  // Keep the selection on a unit the player owns and may field here (the wallet loads after the content).
  useEffect(() => {
    const usable = owned.filter((u) => canField(u, mySide, defense));
    if (selected && usable.some((u) => u.id === selected)) return;
    setSelected([...usable].sort((a, b) => a.cost - b.cost)[0]?.id ?? null);
  }, [owned, selected, mySide, defense]);
  const me = mode === 'online' && net.seat ? net.room?.players[net.seat.side] : undefined;
  const locked = mode === 'online' && !!me?.ready;

  const canPlace = useCallback(
    (x: number, z: number): boolean => {
      const t = engine?.terrain;
      const u = selected ? units.get(selected) : undefined;
      if (!t || !u || !bundle || !isUnlocked(u, player) || !canField(u, mySide, defense)) return false;
      const army = armiesRef.current[mySide];
      const siege = bundle.settings.siege;
      if (isGridStructure(u)) ({ x, z } = snapToCell(x, z));
      else {
        // Riders placed on a wall/tower snap to the cell centre (stand on the highest top,
        // in the middle of the walkway) — validate the snapped spot, not the raw click.
        const pre = gridCells(units, army).get(cellKeyOf(x, z));
        if (pre && (pre.kind === 'wall' || pre.kind === 'platform')) ({ x, z } = snapToCell(x, z));
      }
      if (!t.inZone(mySide, x, z)) return false;
      if (armyCost(bundle, army) + u.cost > myBudget) return false;
      const cells = gridCells(units, army);
      const key = cellKeyOf(x, z);
      const cell = cells.get(key);
      const isBuilding = (id: string) => ['building', 'core'].includes(units.get(id)?.structure ?? '');
      if (isGridStructure(u)) {
        if (u.structure === 'wall' && army.filter((p) => units.get(p.unitId)?.structure === 'wall').length >= siege.maxWallBlocks) return false;
        if (cell) return u.structure === 'wall' && cell.unitId === u.id && cell.blocks < siege.maxTiers;
        const one = new Map([[key, true]]);
        return !army.some((p) => isBuilding(p.unitId) && overlapsGrid(one, p.x, p.z, units.get(p.unitId)!.radius));
      }
      const blocks = army.filter((p) => units.get(p.unitId)?.structure === 'wall').length;
      if (army.length - blocks >= maxUnits) return false;
      if (u.structure === 'core' && army.some((p) => units.get(p.unitId)?.structure === 'core')) return false;
      if (u.structure !== 'none' && overlapsGrid(cells, x, z, u.radius)) return false;
      if (u.structure === 'none' && cell?.kind === 'platform' && cell.riders >= siege.towerCapacity) return false;
      for (const p of army) {
        const other = units.get(p.unitId);
        if (!other || isGridStructure(other)) continue;
        const min = (u.radius + other.radius) * 0.9;
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < min * min) return false;
      }
      return true;
    },
    [engine, selected, units, bundle, mySide, maxUnits, myBudget, player, defense],
  );

  /** Selects a unit type to place (used by both a palette click and a drag pickup). Returns false if it's locked. */
  const pickUnit = useCallback(
    (id: string): boolean => {
      const u = units.get(id);
      if (u && !isUnlocked(u, player)) {
        flash(user ? `Chưa mở khóa ${u.name}: mở trong Bộ sưu tập thẻ ở màn hình chính` : `${u.name} cần đăng nhập và mở khóa`);
        return false;
      }
      setSelected(id);
      setTool('place');
      return true;
    },
    [units, player, user, flash],
  );

  const place = useCallback(
    (x: number, z: number): boolean => {
      if (!selected || !canPlace(x, z)) return false;
      const u = units.get(selected);
      if (u && isGridStructure(u)) ({ x, z } = snapToCell(x, z));
      else if (u && u.structure === 'none') {
        const cells = gridCells(units, armiesRef.current[mySide]);
        const cell = cells.get(cellKeyOf(x, z));
        if (cell && (cell.kind === 'wall' || cell.kind === 'platform')) ({ x, z } = snapToCell(x, z));
      }
      const cur = armiesRef.current;
      setArmies({ ...cur, [mySide]: [...cur[mySide], { unitId: selected, x, z }] });
      return true;
    },
    [selected, canPlace, mySide, setArmies, units],
  );

  /** Removes the nearest unit or building; on a wall cell with nobody on it, its top block. */
  const erase = useCallback(
    (x: number, z: number) => {
      const cur = armiesRef.current;
      let best = -1;
      let bestD = Infinity;
      cur[mySide].forEach((p, i) => {
        const u = units.get(p.unitId);
        if (u && isGridStructure(u)) return;
        const r = Math.max(1.2, (u?.radius ?? 0.5) + 0.6);
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < r * r && d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best < 0) {
        const key = cellKeyOf(x, z);
        cur[mySide].forEach((p, i) => {
          const u = units.get(p.unitId);
          if (u && isGridStructure(u) && cellKeyOf(p.x, p.z) === key) best = i;
        });
      }
      if (best >= 0) setArmies({ ...cur, [mySide]: cur[mySide].filter((_, i) => i !== best) });
    },
    [mySide, units, setArmies],
  );

  // The defenders always start with their keep, at the back of the zone.
  useEffect(() => {
    const t = engine?.terrain;
    if (phase !== 'deploy' || !bundle || !t || defense !== mySide || t.defense !== defense || locked) return;
    const army = armiesRef.current[mySide];
    if (army.some((p) => units.get(p.unitId)?.structure === 'core')) return;
    const core = bundle.units.find((u) => u.structure === 'core' && canField(u, mySide, defense));
    if (!core) return;
    const zone = t.zones[mySide];
    const x = mySide === 'blue' ? zone.x0 + core.radius + 4 : zone.x1 - core.radius - 4;
    setArmies({ ...armiesRef.current, [mySide]: [{ unitId: core.id, x, z: 0 }, ...army] });
  }, [engine, phase, bundle, defense, mySide, locked, armies, units, setArmies, mapVersion]);

  /** `tiers`: wall height the stroke builds every cell up to (the start cell's height after the click). */
  const paint = useRef<{ active: boolean; erase: boolean; x: number; z: number; cell: string; tiers: number }>({ active: false, erase: false, x: 0, z: 0, cell: '', tiers: 1 });
  pointerRef.current = (p: PointerInfo) => {
    if (phase !== 'deploy' || locked) return;
    if (p.type === 'down' && p.button === 0 && p.hit) {
      const del = tool === 'erase' || p.ctrl;
      paint.current = { active: true, erase: del, x: p.x, z: p.z, cell: cellKeyOf(p.x, p.z), tiers: 1 };
      snapshot();
      if (del) erase(p.x, p.z);
      else if (!place(p.x, p.z) && engine?.terrain && !engine.terrain.inZone(mySide, p.x, p.z)) flash(`Chỉ được đặt trong vùng phe ${SIDE_NAME[mySide]}`);
      paint.current.tiers = gridCells(units, armiesRef.current[mySide]).get(paint.current.cell)?.blocks ?? 1;
    } else if (p.type === 'move' && paint.current.active && p.hit && !paint.current.erase && selected && isGridStructure(units.get(selected) ?? { structure: 'none' })) {
      // Walls: drag lays a line cell by cell, raising each cell to the start cell's height.
      const key = cellKeyOf(p.x, p.z);
      if (key === paint.current.cell) return;
      const [x0, z0] = paint.current.cell.split(',').map(Number);
      const x1 = wallIndex(p.x);
      const z1 = wallIndex(p.z);
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
      for (let i = 1; i <= steps; i++) {
        const ix = Math.round(x0 + ((x1 - x0) * i) / steps);
        const iz = Math.round(z0 + ((z1 - z0) * i) / steps);
        const cx = wallCenter(ix);
        const cz = wallCenter(iz);
        for (let k = 0; k < paint.current.tiers; k++) {
          if ((gridCells(units, armiesRef.current[mySide]).get(cellKeyOf(cx, cz))?.blocks ?? 0) >= paint.current.tiers || !place(cx, cz)) break;
        }
      }
      paint.current.cell = key;
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

  // Dragging a card from the palette: it starts outside the canvas, so the canvas's own pointer
  // listeners never see it — feed the engine screen-coordinate events directly instead.
  useEffect(() => {
    if (!engine) return;
    // The canvas fills the whole screen behind the UI panels, so a bounding-rect check alone would
    // treat a release on top of a card or button as "over the map" too — hit-test the actual
    // topmost element instead.
    const overMap = (x: number, y: number) => document.elementFromPoint(x, y) === engine.renderer.domElement;
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
      if (overMap(e.clientX, e.clientY)) engine.dispatchPointer('move', e.clientX, e.clientY, e);
      else engine.hideGhost();
    };
    const onUp = (e: PointerEvent) => {
      if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
      if (overMap(e.clientX, e.clientY)) {
        engine.dispatchPointer('down', e.clientX, e.clientY, e);
        engine.dispatchPointer('up', e.clientX, e.clientY, e);
      } else engine.hideGhost();
      dragRef.current = null;
      setDraggingId(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [engine]);

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
  useEffect(() => engine?.setMuted(muted), [engine, muted]);
  useEffect(() => {
    try {
      setMuted(localStorage.getItem('sb-muted') === '1');
    } catch {}
  }, []);
  const toggleMuted = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem('sb-muted', next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  // ------------------------------------------------------------------ flow
  const bot = bundle?.bots.find((b) => b.id === botId);

  const botArmy = useCallback(
    (enemy: Placement[]): Placement[] => {
      if (!bundle || !bot || !engine?.terrain) return [];
      const redBudget = Math.round(sideBudget(bundle.settings, budget, 'red', defense) * bot.budgetMultiplier);
      if (defense === 'red') return generateSiegeDefense({ bot, content: bundle, terrain: engine.terrain, side: 'red', budget: redBudget, seed: randomSeed() });
      return generateBotArmy({ bot, content: bundle, terrain: engine.terrain, side: 'red', budget: redBudget, enemy, seed: randomSeed() });
    },
    [bundle, bot, engine, budget, defense],
  );

  const startBattle = useCallback(
    (a: Armies, seed = randomSeed(), stars?: Partial<ArmyStars>) => {
      if (!engine) return;
      setArmies(a);
      setResult(null);
      setPaused(false);
      setDesync(false);
      engine.startBattle(a, seed, stars);
      engine.playBattleIntro(mode === 'online' ? mySide : 'blue');
      setPhase('battle');
    },
    [engine, setArmies, mode, mySide],
  );

  resultRef.current = (r) => {
    if (mode === 'online') net.end(r.winner === 'draw' ? 'draw' : r.winner === mySide ? 'win' : 'lose', r.tick);
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
  endOnlineRef.current = (winner) => {
    if (phase !== 'battle') return; // already ended locally (normal finish) — this ack is just a confirmation
    const r: BattleResult = { winner, tick: engine?.sim?.tick ?? 0, reason: 'surrender', survivors: { blue: stats.blue, red: stats.red } };
    setResult(r);
    const show = () => setPhase((p) => (p === 'battle' ? 'result' : p));
    if (winner === 'draw') return void window.setTimeout(show, 1200);
    window.setTimeout(() => (engine ? engine.playVictory(winner, show) : show()), 400);
  };
  const surrenderOnline = () => net.surrender();
  onStartRef.current = (s) => {
    if (bundle && s.configVersion !== bundle.version) flash('Cảnh báo: cấu hình game khác máy chủ — hãy tải lại trang để đồng bộ.');
    if (engine && (engine.map?.id !== s.mapId || (engine.terrain?.defense ?? null) !== s.defense)) {
      engine.loadMap(s.mapId, s.defense);
      setMapVersion((v) => v + 1);
    }
    startBattle(s.armies, s.seed, s.stars);
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

  /** Against the AI the player's upgraded units fight with their stars (local 2-player: none). */
  const aiStars = useMemo<Partial<ArmyStars>>(() => ({ blue: player?.stars ?? {} }), [player]);

  const primaryAction = async () => {
    if (!bundle) return;
    if (myArmy.length === 0) return flash('Hãy đặt ít nhất 1 lính');
    if (mode === 'ai') {
      const red = bot?.reactive ? botArmy(armiesRef.current.blue) : armiesRef.current.red;
      startBattle({ blue: armiesRef.current.blue, red }, randomSeed(), aiStars);
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
    const opts = { bot: { ...RANDOM_FILL, maxUnits: maxUnits }, content: { ...bundle, units: owned }, terrain: engine.terrain, side: mySide, budget: myBudget, seed: randomSeed() };
    const army = defense === mySide ? generateSiegeDefense(opts) : generateBotArmy(opts);
    if (defense === mySide && army.length === 0) return flash('Chưa có Nhà chính trong bộ sưu tập để xây thành');
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

  const totals = useMemo(() => {
    const count = (army: Placement[]) => army.filter((p) => units.get(p.unitId)?.structure !== 'wall').length;
    return { blue: count(armies.blue), red: count(armies.red) };
  }, [armies, units]);
  const resultSide: Side | undefined = mode === 'online' ? net.seat?.side : mode === 'ai' ? 'blue' : undefined;

  // ------------------------------------------------------------------ render
  return (
    <div className="game-ui relative h-screen w-screen overflow-hidden bg-[#cfe3f2] select-none">
      <div ref={hostRef} className="absolute inset-0" />
      {!bundle && <div className="absolute inset-0 flex items-center justify-center font-display text-2xl">Đang tải…</div>}

      <div className="pointer-events-none absolute inset-0 flex flex-col p-3">
        {(phase === 'setup' || phase === 'lobby') && (
          <div className="absolute right-3 top-3 z-10">
            <PlayerHud bundle={bundle} />
          </div>
        )}

        {bundle && phase === 'setup' && mode !== 'online' && (
          <div className="my-auto">
            <SetupPanel bundle={bundle} mode={mode} mapId={mapId} setMapId={setMapId} budget={budget} setBudget={setBudget} botId={botId} setBotId={setBotId} blind={blind} setBlind={setBlind} choice={choice} setChoice={setChoice} onStart={enterDeploy} />
          </div>
        )}

        {bundle && phase === 'lobby' && (
          <div className="my-auto">
            <OnlineLobby
              playerName={user ? user.displayName || user.email || '' : null}
              authLoading={authLoading}
              onSignIn={() => openAuth('signin')}
              connected={net.connected}
              error={net.error}
              initialCode={initialRoom}
              busy={busy}
              onCreate={async () => {
                setBusy(true);
                const r = await net.create();
                setBusy(false);
                if (!r.ok) return flash(r.error);
                window.history.replaceState(null, '', `/play?mode=online&room=${r.code}`);
                introPending.current = true;
                setPhase('deploy');
              }}
              onJoin={async (code) => {
                setBusy(true);
                const r = await net.join(code);
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
                <span className={`rounded-lg px-2 py-1 font-display text-white ${mySide === 'blue' ? 'bg-blue-team' : 'bg-red-team'}`}>
                  Phe {SIDE_NAME[mySide]}
                  {defense && (defense === mySide ? ' · 🏰 Thủ thành' : ' · 🔥 Công thành')}
                </span>
                <div className="w-44">
                  <div className="flex justify-between text-xs font-bold">
                    <span>Ngân sách</span>
                    <span className={spent > myBudget ? 'text-red-team' : ''}>
                      {spent}/{myBudget}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full border-2 border-ink bg-white">
                    <div className="h-full bg-gold" style={{ width: `${Math.min(100, (spent / myBudget) * 100)}%` }} />
                  </div>
                </div>
                <span className="text-xs font-bold">
                  {myArmy.length - wallBlocks}/{maxUnits} lính
                  {wallBlocks > 0 && ` · ${wallBlocks} khối tường`}
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
                <PlayerHud bundle={bundle} />
                <button className={`btn pointer-events-auto text-lg ${locked ? '' : 'btn-gold'}`} disabled={busy} onClick={() => void primaryAction()}>
                  {mode === 'ai' ? '⚔ Bắt đầu!' : mode === 'local' ? (side === 'blue' ? 'Xong → Người chơi 2' : '⚔ Bắt đầu!') : locked ? 'Hủy sẵn sàng' : '✔ Sẵn sàng'}
                </button>
                {mode === 'online' && net.room && net.seat && <RoomBar bundle={bundle} room={net.room} mySide={net.seat.side} onSettings={net.settings} />}
                {mode === 'ai' && bot && (
                  <div className="panel pointer-events-auto p-2 text-xs">
                    Đối thủ: <b>{bot.name}</b> · {bot.reactive ? 'sẽ chọn quân sau khi xem đội hình của bạn' : `${totals.red} lính (${armyCost(bundle, armies.red)})`}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-auto flex items-end gap-2">
              <HelpHint text="Chuột trái: đặt · Shift+kéo: rải · Tường: kéo để xây dãy, bấm lên tường để chồng tầng · Ctrl/⌥+click hoặc X: xóa · Ctrl/⌘+Z: hoàn tác · Chuột phải kéo: xoay/nghiêng · Chuột giữa hoặc Shift+chuột phải: kéo bản đồ · Lăn/pinch: zoom theo con trỏ · WASD/QE" />
              <div className="flex-1">
                <UnitPalette
                  bundle={bundle}
                  thumbs={thumbs}
                  selected={selected}
                  onSelect={pickUnit}
                  draggingId={draggingId}
                  onDragStart={(id, e) => {
                    if (!pickUnit(id)) return;
                    dragRef.current = { id, pointerId: e.pointerId };
                    setDraggingId(id);
                  }}
                  budgetLeft={myBudget - spent}
                  available={(u) => canField(u, mySide, defense)}
                  player={player}
                  stars={mode === 'ai' || (mode === 'online' && net.room?.useStars) ? player?.stars : undefined}
                />
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
            muted={muted}
            onMute={toggleMuted}
            onSpeed={setSpeed}
            onPause={() => setPaused((p) => !p)}
            onStop={mode === 'online' && phase === 'battle' ? surrenderOnline : backToDeploy}
            stopLabel={mode === 'online' ? (phase === 'battle' ? 'Dừng trận' : 'Về xếp quân') : 'Dừng trận'}
            timeLimit={bundle.settings.battleTimeLimit}
            defense={engine?.sim?.defense ?? defense}
          />
        )}
        {desync && phase === 'battle' && <div className="panel pointer-events-auto absolute left-1/2 top-20 -translate-x-1/2 px-3 py-1 text-sm text-red-team">Hai máy đang lệch trận (desync) — kết quả có thể khác nhau.</div>}
      </div>

      {phase === 'result' && result && (
        <ResultModal
          result={result}
          mySide={resultSide}
          siege={!!(engine?.sim?.defense ?? defense)}
          onRematch={mode === 'online' ? backToDeploy : () => startBattle(armiesRef.current, randomSeed(), mode === 'ai' ? aiStars : undefined)}
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
