'use client';

import { ArrowLeft, ArrowRight, Castle, Check, Dices, Flame, LocateFixed, Plus, Swords, Trash2, Undo2, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { botBoxTier, boxTierNum, isUnlocked, playerBudget } from '@/shared/economy';
import type { BotDef, ConfigBundle } from '@/shared/schema';
import { useAuth } from '@/components/auth/AuthProvider';
import BoxOpening from '@/components/player/BoxOpening';
import PlayerHud from '@/components/player/PlayerHud';
import { usePlayer } from '@/components/player/PlayerProvider';
import type { AckResult, ArmyStars, BattleStart, RankMatched } from '@/shared/net';
import type { RankResult } from '@/shared/ranked';
import { generateBotArmy } from '@/game/bot/generate';
import { generateSiegeDefense } from '@/game/bot/siege';
import { useOnline } from '@/game/net/client';
import { BattleEngine, type BattleStats, type CinematicKind, type PointerInfo, type ViewState } from '@/game/render/engine';
import { unitThumbnails } from '@/game/render/thumbnails';
import { armies as fullArmies, armyCost, canField, cellKeyOf, gridCells, isGridStructure, overlapsGrid, sideBudget, snapToCell, type Armies, type Placement } from '@/game/sim/army';
import { ALL_SIDES, wallCenter, wallIndex, type Side } from '@/game/sim/terrain';
import type { BattleResult } from '@/game/sim/world';
import { useConfig } from '@/game/useConfig';
import UnitPalette from './UnitPalette';
import { BattleHud, CinematicBars, Handoff, HelpHint, OnlineLobby, orderedBots, ResultModal, resultTitle, RoomBar, SetupPanel, SIDE_BG, SIDE_NAME, type ModeChoice } from './panels';
import { RankedBar, RankedLobby, RankResultPanel } from './ranked';

export type Mode = 'bot' | 'local' | 'online' | 'ranked';
type Phase = 'setup' | 'lobby' | 'deploy' | 'handoff' | 'battle' | 'result';

const TWO_SIDES: Side[] = ['blue', 'red'];
/** Bot mode opponent sides by chosen bot count (siege forces the 1-bot 'red' case). */
const BOT_OPPONENT_SIDES: Record<number, Side[]> = { 1: ['red'], 2: ['red', 'green'], 3: ['red', 'green', 'yellow'] };
const SIEGE_BOT_SIDES: Side[] = ['red'];
const EMPTY: Armies = fullArmies({});
const randomSeed = () => 1 + Math.floor(Math.random() * (2 ** 31 - 2));

const RANDOM_FILL: BotDef = {
  id: 'random-fill',
  name: 'Random',
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
  if (error) return <p className="p-6 text-red-700">Could not load game config: {error}</p>;
  return <Game mode={mode} initialRoom={initialRoom} bundle={bundle} />;
}

function Game({ mode, initialRoom, bundle }: { mode: Mode; initialRoom?: string; bundle: ConfigBundle | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<BattleEngine | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  /** Room-based modes over the socket: rooms joined by code, and matchmade ranked rooms. */
  const online = mode === 'online' || mode === 'ranked';
  const [phase, setPhase] = useState<Phase>(online ? 'lobby' : 'setup');
  const [mapId, setMapId] = useState('');
  const [botId, setBotId] = useState('');
  /** Bot mode: how many bot opponents (siege ignores this, always 1). */
  const [botCount, setBotCount] = useState(1);
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
  /** Hides the bot-win reward chest once claimed or skipped, until the next battle. */
  const [rewardClosed, setRewardClosed] = useState(false);
  // The engine reports 4×/s: only the HUD subscribes, so the whole game UI does not re-render with it.
  const [stats] = useState(createStatsFeed);
  const [contextLost, setContextLost] = useState(false);
  /** Sides fighting the current/last battle (online: from the server's battle:start; offline: always blue+red). */
  const [matchSides, setMatchSides] = useState<Side[]>(TWO_SIDES);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [desync, setDesync] = useState(false);
  const [cine, setCine] = useState<CinematicKind | null>(null);
  const [view, setView] = useState<ViewState>({ mode: 'overview', unit: null, vr: false });
  const [vrOk, setVrOk] = useState(false);
  const cineRef = useRef<CinematicKind | null>(null);
  /** Deploy UI over the map (top toolbar, its right-hand column, unit tray): the camera works in the space they leave. */
  const toolbarRef = useRef<HTMLDivElement>(null);
  const sideColRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  /** Set on a fresh entry into deployment (not a return from battle) → establishing flight. */
  const introPending = useRef(false);
  /** Ranked: the matched opponent, and what the last battle did to the standing (null while waiting). */
  const [opponent, setOpponent] = useState<RankMatched['opponent'] | null>(null);
  const [rankResult, setRankResult] = useState<AckResult<RankResult> | null>(null);

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
  const { player, act, refresh } = usePlayer();
  const onStartRef = useRef<(s: BattleStart) => void>(() => {});
  /** A `battle:result` that arrives while still in `battle` phase means the other side surrendered: force the transition. */
  const endOnlineRef = useRef<(winner: Side | 'draw') => void>(() => {});
  const net = useOnline(online ? user?.uid ?? null : null, {
    onStart: (s) => onStartRef.current(s),
    onDesync: () => setDesync(true),
    onResult: (res) => {
      flash(res.ok ? 'Máy chủ đã xác nhận và lưu kết quả trận.' : `Kết quả không được lưu: ${res.error}`);
      if (res.ok) endOnlineRef.current(res.winner);
    },
    onEliminate: (side, tick) => engine?.eliminate(side, tick),
    onMatched: (m) => {
      setOpponent(m.opponent);
      setRankResult(null);
      introPending.current = true;
      setPhase('deploy');
    },
    onRankCancelled: (reason) => {
      flash(reason);
      backToRankedLobby();
    },
    onRankResult: (res) => {
      setRankResult(res);
      if (res.ok && res.reward) void refresh();
    },
  });

  useEffect(() => {
    if (net.error) flash(net.error);
  }, [net.error, flash]);

  // ------------------------------------------------------------------ bootstrap
  useEffect(() => {
    if (!bundle) return;
    setMapId((m) => m || bundle.maps[0]?.id || '');
    setBotId((b) => b || bundle.bots.find((x) => x.id === 'thuong')?.id || orderedBots(bundle)[1]?.id || bundle.bots[0]?.id || '');
    setSelected((s) => s ?? [...bundle.units].sort((a, b) => a.cost - b.cost)[0]?.id ?? null);
    void unitThumbnails(bundle).then(setThumbs);
  }, [bundle]);

  const resultRef = useRef<(r: BattleResult) => void>(() => {});
  const pointerRef = useRef<(p: PointerInfo) => void>(() => {});
  const checksumRef = useRef<(t: number, h: number) => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!bundle || !host) return;
    let e: BattleEngine | null = null;
    let live = true;
    // Resolves to null (WebGL) right away unless this browser opted into WebGPU.
    void BattleEngine.loadGpu().then((gpu) => {
      if (!live) return;
      e = new BattleEngine(
        host,
        bundle,
        {
          onPointer: (p) => pointerRef.current(p),
          onResult: (r) => resultRef.current(r),
          onChecksum: (t, h) => checksumRef.current(t, h),
          onStats: stats.set,
          onContextLost: setContextLost,
          onCinematic: (k) => {
            cineRef.current = k;
            setCine(k);
          },
          onView: setView,
        },
        gpu,
      );
      setEngine(e);
      (window as unknown as { __engine?: BattleEngine }).__engine = e;
    });
    return () => {
      live = false;
      e?.dispose();
      setEngine(null);
    };
  }, [bundle]);

  useEffect(() => {
    void BattleEngine.vrSupported().then(setVrOk);
  }, []);

  // online room drives the map
  useEffect(() => {
    if (!online || !net.room) return;
    setMapId(net.room.mapId);
  }, [online, net.room?.mapId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lost the seat (signed out, or the room is gone after a reconnect) → back to the lobby.
  useEffect(() => {
    if (online && !net.seat && phase === 'deploy') setPhase('lobby');
  }, [online, net.seat, phase]);

  /** Siege mode: the defending side (null = open battle). */
  const defense: Side | null = online ? net.room?.defense ?? null : choice === 'battle' ? null : choice;
  /** Bot mode opponents: 1-3 bots on an open battle; siege is always the lone 'red'. */
  const botSides = mode === 'bot' ? (choice === 'battle' ? BOT_OPPONENT_SIDES[botCount] ?? SIEGE_BOT_SIDES : SIEGE_BOT_SIDES) : SIEGE_BOT_SIDES;

  // Seats currently occupied in the room, as a primitive key so the map only rebuilds when someone
  // actually joins/leaves (not on every ready/draft update, which also re-broadcasts room:state).
  const seatKey = online ? ALL_SIDES.map((s) => (net.room?.players[s] ? '1' : '0')).join('') : '';
  const deploySides = useMemo<Side[] | undefined>(() => {
    if (online) {
      const list = ALL_SIDES.filter((_, i) => seatKey[i] === '1');
      return list.length >= 2 ? list : undefined;
    }
    if (mode === 'bot' && botSides.length > 1) return ['blue', ...botSides];
    return undefined;
  }, [mode, online, seatKey, botSides]);

  useEffect(() => {
    if (!engine || !mapId) return;
    engine.loadMap(mapId, defense, deploySides);
    setArmies(EMPTY);
    setMapVersion((v) => v + 1);
  }, [engine, mapId, defense, deploySides, setArmies]);

  // deployment preview
  useEffect(() => {
    if (!engine || !engine.terrain || phase === 'battle' || phase === 'result') return;
    engine.setArmies(armies);
  }, [engine, armies, phase, mapVersion]);

  const units = useMemo(() => new Map((bundle?.units ?? []).map((u) => [u.id, u])), [bundle]);
  /** Units this player may field: free ones, plus the ones unlocked with coins. */
  const owned = useMemo(() => (bundle?.units ?? []).filter((u) => isUnlocked(u, player)), [bundle, player]);

  const maxUnits = bundle?.settings.maxUnitsPerSide ?? 150;
  const mySide: Side = online ? net.seat?.side ?? 'blue' : side;
  const myArmy = armies[mySide];
  const spent = bundle ? armyCost(bundle, myArmy) : 0;
  /** Base budget: online the server's figure for this seat (level budget; ranked: the map's), offline this player's level budget (both local sides too). */
  const seatBudget = online ? net.room?.players[mySide]?.budget : undefined;
  const budget = bundle ? seatBudget ?? playerBudget(player, bundle.settings.economy) : 0;
  const myBudget = bundle ? sideBudget(bundle.settings, budget, mySide, defense) : budget;
  // The server raises the seat budget after the XP of an online battle: reload the wallet to match.
  useEffect(() => {
    if (seatBudget !== undefined) void refresh();
  }, [seatBudget, refresh]);
  const wallBlocks = myArmy.filter((p) => units.get(p.unitId)?.structure === 'wall').length;

  // Keep the selection on a unit the player owns and may field here (the wallet loads after the content).
  useEffect(() => {
    const usable = owned.filter((u) => canField(u, mySide, defense));
    if (selected && usable.some((u) => u.id === selected)) return;
    setSelected([...usable].sort((a, b) => a.cost - b.cost)[0]?.id ?? null);
  }, [owned, selected, mySide, defense]);
  const me = online && net.seat ? net.room?.players[net.seat.side] : undefined;
  const locked = online && !!me?.ready;

  // Live-sync the in-progress army while deploying, so a 30s deploy timeout can force-start with
  // whatever was drafted so far instead of an empty army.
  useEffect(() => {
    if (!online || phase !== 'deploy' || locked) return;
    const id = window.setTimeout(() => net.draft(myArmy), 500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, phase, locked, myArmy]);

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
    const zone = t.zoneOf(mySide);
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
    // Moves outpace frames on high-rate touch screens: hit-test and place the ghost once per frame.
    let raf = 0;
    let last: PointerEvent | null = null;
    const moveNow = () => {
      raf = 0;
      const e = last;
      last = null;
      if (!e || !dragRef.current) return;
      if (overMap(e.clientX, e.clientY)) engine.dispatchPointer('move', e.clientX, e.clientY, e);
      else engine.hideGhost();
    };
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
      last = e;
      raf ||= requestAnimationFrame(moveNow);
    };
    const onUp = (e: PointerEvent) => {
      if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
      cancelAnimationFrame(raf);
      raf = 0;
      last = null;
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
      cancelAnimationFrame(raf);
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
      engine.showZones(mode === 'bot' ? ['blue', ...botSides] : ['blue', 'red']);
      engine.setGhost(null);
      engine.setHidden(null);
    } else {
      engine.showZones([]);
      engine.setGhost(null);
    }
  }, [engine, phase, mySide, mode, blind, tool, selected, locked, canPlace, mapVersion, botSides]);

  // The deploy UI covers the top and bottom of the map: the camera centres, frames and bounds itself to the
  // rest. A layout effect, so the insets are in place before the effect below frames the deployment zone.
  useLayoutEffect(() => {
    if (!engine || phase !== 'deploy') return;
    const canvas = engine.renderer.domElement;
    const measure = () => {
      const c = canvas.getBoundingClientRect();
      const bar = toolbarRef.current?.getBoundingClientRect();
      const col = sideColRef.current?.getBoundingClientRect();
      const tray = trayRef.current?.getBoundingClientRect();
      if (!bar || !col || !tray || !c.height) return;
      const top = Math.max(0, bar.bottom - c.top);
      const bottom = Math.max(0, c.bottom - tray.top);
      // The right-hand column (start button, room or opponent panel) can hang below the toolbar: clear it across
      // the full width, unless leaving its strip out keeps clearly more height (a tall online room panel).
      const below = Math.max(top, col.bottom - c.top);
      const wide = c.height - bottom - below >= (c.height - bottom - top) * 0.7;
      engine.setViewInsets(wide ? { top: below, right: 0, bottom, left: 0 } : { top, right: Math.max(0, c.right - col.left), bottom, left: 0 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [canvas, toolbarRef.current, sideColRef.current, trayRef.current]) if (el) ro.observe(el);
    return () => {
      ro.disconnect();
      engine.setViewInsets(null);
    };
  }, [engine, phase, bundle]);

  // Re-frame the camera only when the viewing side or map changes (not on every tool change).
  // A fresh entry into deployment plays the establishing flight instead — restarted if the
  // side or map changes under it (an online room syncing its map). A return (edit army, new
  // match) snaps straight to the deployment view.
  useEffect(() => {
    if (!engine || phase !== 'deploy') return;
    if (introPending.current || cineRef.current === 'intro') {
      introPending.current = false;
      engine.playDeployIntro(mySide);
    } else engine.frameDeploy(mySide, true);
  }, [engine, phase, mySide, mapVersion]);

  // Left-drag pans the map whenever the left button is not placing units.
  useEffect(() => {
    if (engine) engine.rts.leftPan = phase !== 'deploy' || locked;
  }, [engine, phase, locked]);

  // Only deployment and the battle need every display frame; menus and the result screen run at 30 fps.
  useEffect(() => engine?.setFrameCap(phase === 'deploy' || phase === 'battle' ? null : 30), [engine, phase]);
  // Online sides run unsynchronised simulations: a speed-up or pause would end one player's battle before or after the others.
  useEffect(() => engine?.setSpeed(online ? 1 : speed), [engine, speed, online]);
  useEffect(() => engine?.setPaused(!online && paused), [engine, paused, online]);
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
    (side: Side, enemy: Placement[]): Placement[] => {
      if (!bundle || !bot || !engine?.terrain) return [];
      const sideBudgetAmt = Math.round(sideBudget(bundle.settings, budget, side, defense) * bot.budgetMultiplier);
      if (defense === side) return generateSiegeDefense({ bot, content: bundle, terrain: engine.terrain, side, budget: sideBudgetAmt, seed: randomSeed() });
      return generateBotArmy({ bot, content: bundle, terrain: engine.terrain, side, budget: sideBudgetAmt, enemy, seed: randomSeed() });
    },
    [bundle, bot, engine, budget, defense],
  );

  const startBattle = useCallback(
    (a: Armies, seed = randomSeed(), stars?: Partial<ArmyStars>, sides: Side[] = TWO_SIDES) => {
      if (!engine) return;
      setArmies(a);
      setMatchSides(sides);
      setResult(null);
      setRewardClosed(false);
      setPaused(false);
      setDesync(false);
      engine.startBattle(a, seed, stars);
      engine.playBattleIntro(online ? mySide : 'blue');
      setPhase('battle');
    },
    [engine, setArmies, online, mySide],
  );

  resultRef.current = (r) => {
    if (online) net.end(r.winner === 'draw' ? 'draw' : r.winner === mySide ? 'win' : 'lose', r.tick);
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
    if (online) net.checksum(tick, hash);
  };
  endOnlineRef.current = (winner) => {
    if (phase !== 'battle') return; // already ended locally (normal finish) — this ack is just a confirmation
    const r: BattleResult = { winner, tick: engine?.sim?.tick ?? 0, reason: 'surrender', survivors: stats.get().alive };
    setResult(r);
    const show = () => setPhase((p) => (p === 'battle' ? 'result' : p));
    if (winner === 'draw') return void window.setTimeout(show, 1200);
    window.setTimeout(() => (engine ? engine.playVictory(winner, show) : show()), 400);
  };
  const surrenderOnline = () => net.surrender();
  /** Ranked: out of the finished (or called-off) room, back to the queue screen. */
  function backToRankedLobby() {
    net.leave();
    setResult(null);
    setRankResult(null);
    setOpponent(null);
    setPaused(false);
    setArmies(EMPTY);
    setPhase('lobby');
  }
  onStartRef.current = (s) => {
    if (bundle && s.configVersion !== bundle.version) flash('Cảnh báo: cấu hình game khác máy chủ — hãy tải lại trang để đồng bộ.');
    const loaded = engine?.terrain?.activeSides;
    const sameSides = !!loaded && loaded.length === s.activeSides.length && loaded.every((v, i) => v === s.activeSides[i]);
    if (engine && (engine.map?.id !== s.mapId || (engine.terrain?.defense ?? null) !== s.defense || !sameSides)) {
      engine.loadMap(s.mapId, s.defense, s.activeSides);
      setMapVersion((v) => v + 1);
    }
    startBattle(s.armies, s.seed, s.stars, s.activeSides);
  };

  const enterDeploy = () => {
    setSide('blue');
    setResult(null);
    const next: Armies = fullArmies({});
    if (mode === 'bot' && bot && !bot.reactive) for (const s of botSides) next[s] = botArmy(s, []);
    setArmies(next);
    introPending.current = true;
    setPhase('deploy');
  };

  /** Against the bot the player's upgraded units fight with their stars (local 2-player: none). */
  const botStars = useMemo<Partial<ArmyStars>>(() => ({ blue: player?.stars ?? {} }), [player]);

  /** Tells the server a bot battle starts: its win reward needs this ticket. */
  const startBotTicket = () => {
    if (user && bot) void act({ action: 'bot-start', botId: bot.id, botCount: botSides.length }).catch(() => {});
  };

  const primaryAction = async () => {
    if (!bundle) return;
    if (myArmy.length === 0) return flash('Hãy đặt ít nhất 1 lính');
    if (mode === 'bot') {
      const next = fullArmies({ blue: armiesRef.current.blue });
      for (const s of botSides) next[s] = bot?.reactive ? botArmy(s, armiesRef.current.blue) : armiesRef.current[s];
      startBotTicket();
      startBattle(next, randomSeed(), botStars, ['blue', ...botSides]);
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
      if (e.code === 'Space' && !online && phase === 'battle') {
        e.preventDefault();
        setPaused((p) => !p);
      }
      if (e.key === 'Escape' && phase === 'deploy') setTool('place');
      if (e.key.toLowerCase() === 'x' && phase === 'deploy') setTool((t) => (t === 'erase' ? 'place' : 'erase'));
      if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && phase === 'deploy' && !locked) {
        e.preventDefault();
        undo();
      }
      if (e.key.toLowerCase() === 'v' && phase === 'battle') engine?.cycleView();
      if (e.key.toLowerCase() === 'n' && phase === 'battle') engine?.nextViewUnit();
      const speedKey = { '1': 1, '2': 2 }[e.key];
      if (speedKey && !online && (phase === 'battle' || phase === 'result')) setSpeed(speedKey);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const totals = useMemo(() => {
    const count = (army: Placement[]) => army.filter((p) => units.get(p.unitId)?.structure !== 'wall').length;
    const out: Partial<Record<Side, number>> = {};
    for (const s of matchSides) out[s] = count(armies[s]);
    return out;
  }, [armies, units, matchSides]);
  const resultSide: Side | undefined = online ? net.seat?.side : mode === 'bot' ? 'blue' : undefined;

  // ------------------------------------------------------------------ render
  return (
    <div className="game-ui relative h-dvh w-screen overflow-hidden bg-[#cfe3f2] select-none">
      <div ref={hostRef} className="absolute inset-0" />
      {!bundle && <div className="absolute inset-0 flex items-center justify-center font-display text-2xl">Đang tải…</div>}

      <div className="pointer-events-none absolute inset-0 flex flex-col p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        {(phase === 'setup' || phase === 'lobby') && (
          <div className="absolute right-3 top-3 z-10">
            <PlayerHud bundle={bundle} />
          </div>
        )}

        {bundle && phase === 'setup' && !online && (
          <div className="pointer-events-auto m-auto flex max-h-full min-h-0 w-full justify-center overflow-y-auto overscroll-contain touch-pan-y">
            <SetupPanel bundle={bundle} mode={mode} mapId={mapId} setMapId={setMapId} player={player} botId={botId} setBotId={setBotId} botCount={botCount} setBotCount={setBotCount} blind={blind} setBlind={setBlind} choice={choice} setChoice={setChoice} onStart={enterDeploy} />
          </div>
        )}

        {bundle && phase === 'lobby' && mode === 'ranked' && (
          <div className="pointer-events-auto m-auto flex max-h-full min-h-0 w-full justify-center overflow-y-auto overscroll-contain touch-pan-y">
            <RankedLobby
              bundle={bundle}
              thumbs={thumbs}
              playerName={user ? user.displayName || user.email || '' : null}
              authLoading={authLoading}
              onSignIn={() => openAuth('signin')}
              connected={net.connected}
              error={net.error}
              queue={net.queue}
              cancel={net.cancelQueue}
              flash={flash}
            />
          </div>
        )}

        {bundle && phase === 'lobby' && mode === 'online' && (
          <div className="pointer-events-auto m-auto flex max-h-full min-h-0 w-full justify-center overflow-y-auto overscroll-contain touch-pan-y">
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

        {/* Laid out (invisible) during the intro flight too: the flight ends on a view framed around this UI. */}
        {bundle && phase === 'deploy' && (
          <>
            <div className={`flex flex-wrap items-start gap-1.5 sm:gap-2 ${cine ? 'invisible' : ''}`}>
              <div ref={toolbarRef} className="panel pointer-events-auto flex min-w-0 flex-1 flex-wrap items-center gap-1 overflow-y-auto overscroll-contain p-1.5 sm:gap-2 sm:overflow-visible sm:p-2 max-h-[24vh] sm:max-h-none">
                <Link href="/" className="btn px-2 py-1 text-sm" aria-label="Về menu">
                  <ArrowLeft />
                </Link>
                <span className={`rounded-lg px-1.5 py-1 font-display text-white sm:px-2 ${SIDE_BG[mySide]}`}>
                  <span className="hidden sm:inline">Phe </span>
                  {SIDE_NAME[mySide]}
                  {defense && <span className="hidden sm:inline">{defense === mySide ? <> · <Castle /> Thủ thành</> : <> · <Flame /> Công thành</>}</span>}
                </span>
                <span className="text-xs font-bold">
                  {myArmy.length - wallBlocks}/{maxUnits} lính
                  {wallBlocks > 0 && ` · ${wallBlocks} khối tường`}
                </span>
                <button className={`btn px-2 py-1 text-sm ${tool === 'place' ? 'btn-gold' : ''}`} onClick={() => setTool('place')} title="Đặt" aria-label="Đặt quân">
                  <Plus /><span className="hidden sm:inline"> Đặt</span>
                </button>
                <button className={`btn px-2 py-1 text-sm ${tool === 'erase' ? 'btn-gold' : ''}`} onClick={() => setTool('erase')} title="Xóa (X)" aria-label="Xóa quân">
                  <X /><span className="hidden sm:inline"> Xóa</span>
                </button>
                <button className="btn px-2 py-1 text-sm" disabled={locked} onClick={fillRandom} title="Ngẫu nhiên" aria-label="Xếp quân ngẫu nhiên">
                  <Dices /><span className="hidden sm:inline"> Ngẫu nhiên</span>
                </button>
                <button className="btn px-2 py-1 text-sm" disabled={locked} onClick={undo} title="Hoàn tác (Ctrl/⌘+Z)" aria-label="Hoàn tác">
                  <Undo2 /><span className="hidden sm:inline"> Hoàn tác</span>
                </button>
                <button
                  className="btn px-2 py-1 text-sm"
                  disabled={locked}
                  onClick={() => {
                    snapshot();
                    setArmies({ ...armiesRef.current, [mySide]: [] });
                  }}
                  title="Xóa hết"
                  aria-label="Xóa hết quân"
                >
                  <Trash2 /><span className="hidden sm:inline"> Xóa hết</span>
                </button>
              </div>
              <div ref={sideColRef} className="ml-auto flex min-w-0 max-w-[46vw] shrink-0 flex-col items-end gap-2 sm:max-w-none">
                <div className="hidden max-w-full sm:block">
                  <PlayerHud bundle={bundle} />
                </div>
                <button className={`btn pointer-events-auto max-w-full px-3 py-2 min-h-[44px] text-base sm:px-4 sm:py-2 sm:text-lg ${locked ? '' : 'btn-gold'}`} disabled={busy} onClick={() => void primaryAction()}>
                  {mode === 'bot' ? (
                    <>
                      <Swords /><span className="sm:hidden">Bắt đầu</span><span className="hidden sm:inline"> Bắt đầu!</span>
                    </>
                  ) : mode === 'local' ? (
                    side === 'blue' ? (
                      <>
                        <ArrowRight /><span className="sm:hidden">Xong → P2</span><span className="hidden sm:inline"> Xong, tới Người chơi 2</span>
                      </>
                    ) : (
                      <>
                        <Swords /><span className="sm:hidden">Bắt đầu</span><span className="hidden sm:inline"> Bắt đầu!</span>
                      </>
                    )
                  ) : locked ? (
                    <>
                      <X /><span className="sm:hidden">Hủy</span><span className="hidden sm:inline"> Hủy sẵn sàng</span>
                    </>
                  ) : (
                    <>
                      <Check /><span className="sm:hidden">Sẵn sàng</span><span className="hidden sm:inline"> Sẵn sàng</span>
                    </>
                  )}
                </button>
                {mode === 'online' && net.room && net.seat && <RoomBar bundle={bundle} room={net.room} mySide={net.seat.side} onSettings={net.settings} />}
                {mode === 'ranked' && net.room && net.seat && <RankedBar bundle={bundle} room={net.room} opponent={opponent} mySide={net.seat.side} />}
                {mode === 'bot' && bot && (
                  <div className="panel pointer-events-auto hidden max-w-[calc(100vw-1.5rem)] p-2 text-xs sm:block">
                    Đối thủ: <b>{bot.name}</b>
                    {botSides.length > 1 ? ` ×${botSides.length}` : ''} ·{' '}
                    {bot.reactive
                      ? 'sẽ chọn quân sau khi xem đội hình của bạn'
                      : `${botSides.reduce((n, s) => n + (totals[s] ?? 0), 0)} lính (${botSides.reduce((n, s) => n + armyCost(bundle, armies[s]), 0)})`}
                  </div>
                )}
              </div>
            </div>
            <div ref={trayRef} className={`mt-auto flex items-end gap-1.5 sm:gap-2 ${cine ? 'invisible' : ''}`}>
              <HelpHint text="Chuột trái: đặt · Shift+kéo: rải · Tường: kéo để xây dãy, bấm lên tường để chồng tầng · Ctrl/⌥+click hoặc X: xóa · Ctrl/⌘+Z: hoàn tác · Chuột phải kéo: xoay/nghiêng · Chuột giữa hoặc Shift+chuột phải: kéo bản đồ · Lăn/pinch: zoom theo con trỏ · WASD/QE" />
              <div className="min-w-0 flex-1">
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
                  stars={mode === 'bot' || (online && net.room?.useStars) ? player?.stars : undefined}
                  action={
                    <button className="btn px-2 py-0.5 text-xs sm:text-sm" onClick={() => engine?.frameDeploy(mySide)} title="Đưa camera về khung xếp quân" aria-label="Về giữa">
                      <LocateFixed /> Về giữa
                    </button>
                  }
                />
              </div>
            </div>
          </>
        )}

        {bundle && (phase === 'battle' || phase === 'result') && !cine && (
          <LiveBattleHud
            activeSides={matchSides}
            stats={stats}
            total={totals}
            speed={speed}
            paused={paused}
            muted={muted}
            onMute={toggleMuted}
            onSpeed={online ? undefined : setSpeed}
            onPause={online ? undefined : () => setPaused((p) => !p)}
            onStop={online && phase === 'battle' ? surrenderOnline : mode === 'ranked' ? backToRankedLobby : backToDeploy}
            stopLabel={online ? (phase === 'battle' ? 'Dừng trận' : mode === 'ranked' ? 'Về sảnh xếp hạng' : 'Về xếp quân') : 'Dừng trận'}
            timeLimit={bundle.settings.battleTimeLimit}
            defense={engine?.sim?.defense ?? defense}
            view={view}
            onView={(m) => engine?.setViewMode(m)}
            onNextUnit={() => engine?.nextViewUnit()}
            onVR={vrOk ? () => (view.vr ? engine?.exitVR() : void engine?.enterVR().catch((err) => flash(`Không vào được VR: ${err instanceof Error ? err.message : err}`))) : undefined}
          />
        )}
        {desync && phase === 'battle' && <div className="panel pointer-events-auto absolute left-1/2 top-20 max-w-[calc(100vw-2rem)] -translate-x-1/2 break-words px-3 py-1 text-center text-sm text-red-team">Hai máy đang lệch trận (desync) — kết quả có thể khác nhau.</div>}
      </div>

      {phase === 'result' && result && (
        <ResultModal
          result={result}
          mySide={resultSide}
          siege={!!(engine?.sim?.defense ?? defense)}
          onRematch={
            mode === 'ranked'
              ? backToRankedLobby
              : mode === 'online'
                ? backToDeploy
                : () => {
                    if (mode === 'bot') startBotTicket();
                    startBattle(armiesRef.current, randomSeed(), mode === 'bot' ? botStars : undefined, mode === 'bot' ? ['blue', ...botSides] : TWO_SIDES);
                  }
          }
          rematchLabel={mode === 'ranked' ? 'Tìm trận mới' : mode === 'online' ? 'Trận mới' : 'Đấu lại'}
          onEdit={mode === 'ranked' ? undefined : backToDeploy}
        >
          {mode === 'ranked' && bundle && <RankResultPanel bundle={bundle} res={rankResult} />}
        </ResultModal>
      )}
      {bundle && user && mode === 'bot' && bot && phase === 'result' && result && result.winner === 'blue' && !rewardClosed && (
        <BoxOpening
          bundle={bundle}
          action={{ action: 'bot-win' }}
          title={`Chiến lợi phẩm: ${bot.name}`}
          tier={boxTierNum(botBoxTier(bundle.settings.economy, bot.difficulty))}
          thumbs={thumbs}
          onClose={() => setRewardClosed(true)}
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
      {toast && <div className="panel pointer-events-none absolute left-1/2 top-16 max-w-[calc(100vw-2rem)] -translate-x-1/2 break-words px-4 py-2 text-center font-bold">{toast}</div>}
      {contextLost && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="panel max-w-sm p-4 text-center">
            <p className="font-bold">Máy đã thu hồi bộ nhớ đồ họa của trận đấu.</p>
            <p className="mt-1 text-sm">Đang thử khôi phục… Nếu màn hình vẫn đen, hãy tải lại trang.</p>
            <button className="btn btn-gold pointer-events-auto mt-3 px-4 py-1" onClick={() => window.location.reload()}>
              Tải lại trang
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface StatsFeed {
  get(): BattleStats;
  set(s: BattleStats): void;
  subscribe(listener: () => void): () => void;
}

function createStatsFeed(): StatsFeed {
  let value: BattleStats = { alive: {}, time: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (s) => {
      value = s;
      for (const l of listeners) l();
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

function LiveBattleHud({ stats, ...props }: Omit<ComponentProps<typeof BattleHud>, 'stats'> & { stats: StatsFeed }) {
  const live = useSyncExternalStore(stats.subscribe, stats.get, stats.get);
  return <BattleHud {...props} stats={live} />;
}
