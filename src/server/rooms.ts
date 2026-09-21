// Online PvP rooms. The server never simulates: it validates both armies against the
// CMS content, picks a seed, and both browsers run the same deterministic battle.
// Periodic checksums from each side detect desyncs; a result is saved only when both
// players report the same end (see matches.ts).
//
// Hardening: only signed-in, enabled users from this site's origin connect; one live
// connection per account; per-socket event rate limit; malformed packets are dropped.
// Unit unlocks and star levels come from each player's Firestore wallet, never from the client.
//
// Ranked: players queue instead of sharing a code; matchmaking (src/shared/ranked.ts) seats two of
// them in a fresh room with fixed settings for one battle, then settles both standings.
import { randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { armyCost, armySchema, sideBudget, validateArmy, type Armies, type Placement } from '@/game/sim/army';
import { SIM_HZ } from '@/game/sim/world';
import { ALL_SIDES, Terrain, type Side } from '@/game/sim/terrain';
import { isUnlocked, vnDay, type PlayerState, type RankState } from '@/shared/economy';
import { UNAUTHORIZED, type ArmyStars, type ClientToServer, type RoomState, type ServerToClient } from '@/shared/net';
import { pairKey, pickPairs, type QueueEntry } from '@/shared/ranked';
import { idSchema, type ConfigBundle } from '@/shared/schema';
import type { AppUser } from '@/shared/users';
import { getBundle } from './content';
import { CHECKSUM_EVERY, judgeMatch, saveMatch, type BattleRecord, type MatchPlayer } from './matches';
import { recordBattleResult, recordBattleStart, recordBattleVoid, recordSaveFailed, registerRooms } from './metrics';
import { getPlayer } from './players';
import { rankEntry, settleRanked, type RankSettleInput, type RankSettlement } from './ranked';
import { SESSION_COOKIE, userFromSessionCookie } from './users';

/** Deployment countdown: the battle auto-starts at this deadline even if not everyone is ready. */
const DEPLOY_MS = 30_000;
/**
 * Ticks between the furthest simulation the server has heard from and the tick a surrender or
 * disconnect is applied at. Covers the up-to-one-interval-old report, the round trip and a 4× speed-up.
 */
const ELIMINATION_LEAD = CHECKSUM_EVERY * 4;
/** Ranked matchmaking pass interval while anyone is queued. */
const MATCH_EVERY_MS = 2000;

interface Player {
  uid: string;
  socketId: string | null;
  name: string;
  ready: boolean;
  army: Placement[];
  /** Star levels of the army's units, read from the wallet when the player got ready. */
  stars: Record<string, number>;
}

interface Room {
  code: string;
  phase: 'lobby' | 'battle';
  mapId: string;
  budget: number;
  /** Host setting: upgraded units fight with their star bonus. */
  useStars: boolean;
  /** Host setting: siege mode with this side defending (null = open battle). */
  defense: Side | null;
  players: Partial<Record<Side, Player>>;
  /** Current battle until it is saved or voided (the phase returns to lobby at the first report). */
  battle: BattleRecord | null;
  cleanup: NodeJS.Timeout | null;
  /** Deployment countdown, running while 2-4 seats are connected in the lobby. */
  deployDeadline: number | null;
  deployTimer: NodeJS.Timeout | null;
  /**
   * Matchmade ranked room: fixed settings, no joining by code, one battle. `closed` once that battle
   * started or was called off; `ips` feed the same-IP flag.
   */
  ranked: { season: string; closed: boolean; ips: Partial<Record<Side, string | null>> } | null;
}

interface SocketData {
  user: AppUser;
  cookie: string;
}

export type RoomServer = Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>;
type Sock = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

export interface RoomDeps {
  authenticate(cookie: string | undefined): Promise<AppUser | null>;
  saveMatch(battle: BattleRecord, winner: Side | 'draw', tick: number): Promise<void>;
  /** The player's wallet: unlocked units and star levels. */
  loadPlayer(uid: string): Promise<PlayerState>;
  /** Ranked: season, standing, matchmaking steps and why the player may not queue (if so). */
  rankEntry(user: AppUser): Promise<{ season: string | null; rank: RankState | null; steps: number; gate: string | null }>;
  /** Ranked: applies a finished battle to both standings (null when its season is over). */
  settleRanked(input: RankSettleInput): Promise<RankSettlement | null>;
  /** Deployment countdown duration in ms (tests shorten this; defaults to DEPLOY_MS). */
  deployMs?: number;
}

const rooms = new Map<string, Room>();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Socket.IO packet size cap: a 500-unit army is ~30 KB of JSON. */
export const MAX_PACKET_BYTES = 100_000;
const RATE_WINDOW_MS = 1000;
const RATE_MAX_EVENTS = 20;
/** Events whose last argument must be the ack callback. */
const ACK_EVENTS = new Set(['room:create', 'room:join', 'room:ready', 'rank:queue']);

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

/** Client IP for the same-IP rule: Cloudflare's header behind the tunnel (the app is only published through it), else the socket address. */
function clientIp(socket: Sock): string | null {
  const cf = socket.handshake.headers['cf-connecting-ip'];
  return (typeof cf === 'string' && cf.trim()) || socket.handshake.address || null;
}

function playerName(user: AppUser): string {
  return (user.displayName || user.email?.split('@')[0] || 'Tướng quân').trim().slice(0, 20);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Socket.IO `allowRequest`: the handshake must come from a page of this site (blocks cross-site WebSocket hijacking). */
export function allowSocketRequest(req: IncomingMessage, callback: (err: string | null | undefined, success: boolean) => void): void {
  const hosts = [req.headers.host, req.headers['x-forwarded-host']].flatMap((h) => (typeof h === 'string' ? h.split(',').map((s) => s.trim()) : []));
  let ok = false;
  try {
    ok = Boolean(req.headers.origin) && hosts.includes(new URL(req.headers.origin!).host);
  } catch {
    ok = false;
  }
  callback(ok ? null : 'Origin không hợp lệ', ok);
}

async function publicState(room: Room): Promise<RoomState> {
  const bundle = await getBundle();
  const players: RoomState['players'] = {};
  for (const side of ALL_SIDES) {
    const p = room.players[side];
    if (p) players[side] = { name: p.name, ready: p.ready, connected: p.socketId !== null, units: p.army.length, cost: armyCost(bundle, p.army) };
  }
  return { code: room.code, phase: room.phase, mapId: room.mapId, budget: room.budget, useStars: room.useStars, defense: room.defense, players, deadline: room.deployDeadline, ranked: room.ranked?.season ?? null };
}

/** Connected seats, in join order. */
function connectedSides(room: Room): Side[] {
  return ALL_SIDES.filter((s) => room.players[s]?.socketId);
}

/** Max seats a room can hold: siege mode is attacker/defender only. */
function seatCap(room: Pick<Room, 'defense'>): number {
  return room.defense !== null ? 2 : 4;
}

export function attachRooms(io: RoomServer, deps: RoomDeps = { authenticate: userFromSessionCookie, saveMatch, loadPlayer: getPlayer, rankEntry, settleRanked }): void {
  const deployMs = deps.deployMs ?? DEPLOY_MS;
  /** Live socket per uid: a new connection replaces the old one. */
  const online = new Map<string, Sock>();

  interface Queued {
    entry: QueueEntry;
    socket: Sock;
    season: string;
    name: string;
    rank: RankState | null;
    /** Seats the queued socket in a room the server picked. */
    seat(room: Room, side: Side): void;
  }
  /** Ranked matchmaking queue, by uid. */
  const queue = new Map<string, Queued>();
  let matchTimer: NodeJS.Timeout | null = null;
  /** Ranked battles per pair of accounts today, as last settled (keeps matchmaking off pairs at their daily limit). */
  const pairsToday = new Map<string, { day: string; count: number }>();

  const broadcast = async (room: Room) => {
    syncDeployTimer(room);
    const state = await publicState(room);
    io.to(room.code).emit('room:state', state);
  };

  registerRooms(() => {
    const all = [...rooms.values()];
    return {
      sockets: online.size,
      rooms: all.length,
      lobbies: all.filter((r) => !r.battle).length,
      battles: all.flatMap((r) =>
        r.battle
          ? [{ code: r.code, players: r.battle.activeSides.map((s) => ({ side: s, name: r.battle!.players[s]?.name ?? '?' })), mapId: r.battle.mapId, siege: r.battle.defense !== null, startedAt: r.battle.startedAt }]
          : [],
      ),
    };
  });

  /** `kind` groups the void in monitoring (the error shown to players can contain names). */
  const voidBattle = (room: Room, error: string, kind: string) => {
    const battle = room.battle;
    if (!battle) return;
    room.battle = null;
    recordBattleVoid(kind);
    io.to(room.code).emit('battle:result', { ok: false, error });
    void finishRanked(room, battle, null, 'report');
  };

  /** Applies a finished ranked battle (winner null = voided, a dispute) to both standings and tells each player what changed. */
  const finishRanked = async (room: Room, battle: BattleRecord, winner: Side | 'draw' | null, ended: 'report' | 'forfeit') => {
    const ranked = room.ranked;
    if (!battle.ranked || !ranked) return;
    const bundle = await getBundle();
    const sides = battle.activeSides;
    const input: RankSettleInput = {
      season: battle.ranked,
      room: room.code,
      match: {
        winner,
        ended,
        durationMs: Date.now() - battle.startedAt,
        budget: battle.budget,
        sides: Object.fromEntries(sides.map((s) => [s, { uid: battle.players[s]!.uid, ip: ranked.ips[s] ?? null, armyCost: armyCost(bundle, battle.armies[s]) }])),
      },
      names: Object.fromEntries(sides.map((s) => [s, battle.players[s]!.name])),
    };
    // Players may already be back in the ranked lobby (out of this room): reach their live socket.
    const tell = (s: Side, res: Parameters<ServerToClient['rank:result']>[0]) => online.get(battle.players[s]!.uid)?.emit('rank:result', res);
    try {
      const settled = await deps.settleRanked(input);
      if (!settled) return void sides.forEach((s) => tell(s, { ok: false, error: 'Mùa giải đã kết thúc — trận này không tính xếp hạng' }));
      const [a, b] = sides.map((s) => battle.players[s]!.uid);
      pairsToday.set(pairKey(a, b), { day: vnDay(Date.now()), count: settled.pairCount });
      for (const s of sides) {
        const result = settled.sides[s];
        if (result) tell(s, { ok: true, ...result });
      }
    } catch (e) {
      recordSaveFailed();
      console.error(`Không lưu được kết quả xếp hạng phòng ${room.code}:`, e instanceof Error ? e.message : e);
      sides.forEach((s) => tell(s, { ok: false, error: 'Máy chủ không lưu được kết quả xếp hạng' }));
    }
  };

  const settle = async (room: Room) => {
    const battle = room.battle!;
    room.battle = null;
    const verdict = judgeMatch(battle);
    if (!verdict.ok) {
      recordBattleVoid(verdict.error);
      io.to(room.code).emit('battle:result', verdict);
      return void (await finishRanked(room, battle, null, 'report'));
    }
    try {
      await deps.saveMatch(battle, verdict.winner, verdict.tick);
      recordBattleResult(verdict.winner);
      io.to(room.code).emit('battle:result', { ok: true, winner: verdict.winner });
    } catch (e) {
      recordSaveFailed();
      console.error(`Không lưu được kết quả trận phòng ${room.code}:`, e instanceof Error ? e.message : e);
      io.to(room.code).emit('battle:result', { ok: false, error: 'Máy chủ không lưu được kết quả trận' });
    }
    await finishRanked(room, battle, verdict.winner, 'report');
  };

  /** Every active side has either reported or will never report (disconnected): settle now, filling in a loss for the latter. */
  const maybeSettle = async (room: Room) => {
    const battle = room.battle;
    if (!battle) return;
    if (!battle.activeSides.every((s) => battle.reports[s] || battle.disconnected.has(s))) return;
    const known = battle.activeSides.map((s) => battle.reports[s]).find((r) => r);
    const tick = known ? known.tick : Math.max(0, ...battle.verified);
    for (const s of battle.activeSides) if (!battle.reports[s]) battle.reports[s] = { outcome: 'lose', tick };
    await settle(room);
  };

  /**
   * A side leaves the fight (surrender or disconnect): every client applies it at the same future
   * tick. If only one side is left standing, the server declares it the winner right away, without
   * waiting for reports (mirrors the old immediate 1v1 surrender). Otherwise the battle continues
   * and settles normally once the survivors' simulations report in.
   */
  const eliminate = async (room: Room, side: Side, disconnected: boolean) => {
    const battle = room.battle;
    if (!battle || battle.reports[side] || battle.eliminated.has(side)) return;
    battle.eliminated.add(side);
    if (disconnected) battle.disconnected.add(side);
    // Past the fastest simulation (sides run unsynchronised: skipped intro, speed-up, slow device),
    // or a client already beyond this tick could never apply it and would fight a ghost army.
    const reached = Math.max(0, ...battle.verified, ...Object.values(battle.lastTick));
    const tick = Math.min(battle.maxTick, reached + ELIMINATION_LEAD);
    io.to(room.code).emit('battle:eliminate', { side, tick });
    const remaining = battle.activeSides.filter((s) => !battle.eliminated.has(s));
    if (remaining.length > 1) return void (await maybeSettle(room));
    room.battle = null;
    room.phase = 'lobby';
    for (const p of Object.values(room.players)) if (p) p.ready = false;
    const winner: Side | 'draw' = remaining.length === 1 ? remaining[0] : 'draw';
    const endTick = Math.max(0, ...battle.verified);
    try {
      await deps.saveMatch(battle, winner, endTick);
      recordBattleResult(winner);
    } catch (e) {
      recordSaveFailed();
      console.error(`Không lưu được kết quả trận phòng ${room.code}:`, e instanceof Error ? e.message : e);
    }
    io.to(room.code).emit('battle:result', { ok: true, winner });
    void broadcast(room);
    await finishRanked(room, battle, winner, 'forfeit');
  };

  /** Starts the battle with whichever connected seats are given (all ready, or a 30s timeout force-start). */
  const startBattle = async (room: Room, active: Side[]) => {
    const bundle = await getBundle();
    const map = bundle.maps.find((m) => m.id === room.mapId);
    if (!map) return;
    clearDeployTimer(room);
    const terrain = new Terrain(map, bundle.assets, room.defense, active);
    const armies = Object.fromEntries(ALL_SIDES.map((s) => [s, [] as Placement[]])) as Armies;
    const stars = Object.fromEntries(ALL_SIDES.map((s) => [s, {} as Record<string, number>])) as ArmyStars;
    const players: Partial<Record<Side, MatchPlayer>> = {};
    for (const s of active) {
      const p = room.players[s]!;
      let army = p.army;
      if (!p.ready) {
        // Timed out before readying: fight with whatever was drafted, dropping it only if it's invalid.
        const budget = sideBudget(bundle.settings, room.budget, s, room.defense);
        const check = validateArmy(bundle, terrain, s, army, budget);
        if (!check.ok) army = [];
      }
      armies[s] = army;
      if (room.useStars) stars[s] = p.stars;
      players[s] = { uid: p.uid, name: p.name };
    }
    room.phase = 'battle';
    if (room.ranked) room.ranked.closed = true;
    const start = {
      seed: randomInt(1, 2 ** 31 - 1),
      mapId: room.mapId,
      budget: room.budget,
      armies,
      activeSides: active,
      useStars: room.useStars,
      defense: room.defense,
      stars,
      configVersion: bundle.version,
    };
    room.battle = {
      ...start,
      code: room.code,
      ranked: room.ranked?.season ?? null,
      players,
      startedAt: Date.now(),
      maxTick: Math.round(bundle.settings.battleTimeLimit * SIM_HZ),
      reports: {},
      checksums: new Map(),
      verified: new Set(),
      lastTick: {},
      desync: false,
      eliminated: new Set(),
      disconnected: new Set(),
    };
    recordBattleStart();
    io.to(room.code).emit('battle:start', start);
    void broadcast(room);
  };

  const clearDeployTimer = (room: Room) => {
    if (room.deployTimer) clearTimeout(room.deployTimer);
    room.deployTimer = null;
    room.deployDeadline = null;
  };

  /** Starts, keeps or clears the 30s deployment countdown to match the room's current state. */
  const syncDeployTimer = (room: Room) => {
    if (room.phase !== 'lobby' || room.ranked?.closed || connectedSides(room).length < 2) return void clearDeployTimer(room);
    if (room.deployTimer) return;
    room.deployDeadline = Date.now() + deployMs;
    room.deployTimer = setTimeout(() => {
      room.deployTimer = null;
      room.deployDeadline = null;
      void forceStart(room);
    }, deployMs);
  };

  const forceStart = async (room: Room) => {
    if (room.phase !== 'lobby' || room.battle || room.ranked?.closed) return;
    const active = connectedSides(room);
    if (active.length < 2) return;
    await startBattle(room, active);
  };

  const unqueue = (uid: string, socket: Sock) => {
    if (queue.get(uid)?.socket !== socket) return;
    queue.delete(uid);
    if (queue.size === 0 && matchTimer) {
      clearInterval(matchTimer);
      matchTimer = null;
    }
  };

  /** Seats a matched pair in a fresh ranked room on a random ranked map. */
  const openRanked = (bundle: ConfigBundle, a: Queued, b: Queued) => {
    const pool = bundle.maps.filter((m) => bundle.settings.ranked.mapIds.includes(m.id));
    const maps = pool.length > 0 ? pool : bundle.maps;
    const map = maps.length > 0 ? maps[randomInt(maps.length)] : null;
    if (!map) {
      for (const q of [a, b]) q.socket.emit('rank:cancelled', { reason: 'Chưa có bản đồ nào trong CMS' });
      return;
    }
    const room: Room = { code: newCode(), phase: 'lobby', mapId: map.id, budget: map.budget, useStars: true, defense: null, players: {}, battle: null, cleanup: null, deployDeadline: null, deployTimer: null, ranked: { season: a.season, closed: false, ips: {} } };
    rooms.set(room.code, room);
    const seats = [[a, 'blue', b], [b, 'red', a]] as const;
    for (const [q, side] of seats) {
      room.players[side] = { uid: q.entry.uid, socketId: q.socket.id, name: q.name, ready: false, army: [], stars: {} };
      room.ranked!.ips[side] = q.entry.ip;
      q.seat(room, side);
    }
    for (const [q, side, other] of seats) q.socket.emit('rank:matched', { code: room.code, side, opponent: { name: other.name, rank: other.rank } });
    void broadcast(room);
  };

  const matchmake = async () => {
    if (queue.size < 2) return;
    const bundle = await getBundle();
    const cfg = bundle.settings.ranked;
    const now = Date.now();
    const today = vnDay(now);
    const full = (a: string, b: string) => {
      const pair = pairsToday.get(pairKey(a, b));
      return !!pair && pair.day === today && pair.count >= cfg.pairDailyLimit;
    };
    for (const [a, b] of pickPairs([...queue.values()].map((q) => q.entry), now, cfg, full)) {
      const qa = queue.get(a.uid);
      const qb = queue.get(b.uid);
      if (!qa || !qb || qa.season !== qb.season) continue;
      unqueue(a.uid, qa.socket);
      unqueue(b.uid, qb.socket);
      openRanked(bundle, qa, qb);
    }
  };

  io.use(async (socket, next) => {
    const cookie = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
    const user = await deps.authenticate(cookie).catch(() => null);
    if (!user || !cookie) return next(new Error(UNAUTHORIZED));
    socket.data.user = user;
    socket.data.cookie = cookie;
    next();
  });

  io.on('connection', (socket: Sock) => {
    const { user } = socket.data;
    let room: Room | null = null;
    let side: Side | null = null;

    online.get(user.uid)?.disconnect(true);
    online.set(user.uid, socket);

    let windowStart = Date.now();
    let events = 0;
    socket.use((packet, next) => {
      const now = Date.now();
      if (now - windowStart >= RATE_WINDOW_MS) {
        windowStart = now;
        events = 0;
      }
      if (++events > RATE_MAX_EVENTS) return void socket.disconnect(true);
      // A missing ack would throw inside the handler; drop the packet instead.
      if (ACK_EVENTS.has(packet[0]) && typeof packet[packet.length - 1] !== 'function') return;
      next();
    });

    const leave = () => {
      unqueue(user.uid, socket);
      if (!room || !side) return;
      const r = room;
      const s = side;
      const p = r.players[s];
      if (p && p.socketId === socket.id) {
        p.socketId = null;
        p.ready = false;
      }
      if (r.battle && !r.battle.reports[s] && !r.battle.eliminated.has(s)) void eliminate(r, s, true);
      if (r.ranked && !r.ranked.closed) {
        // A matched ranked battle that has not started is called off for both.
        r.ranked.closed = true;
        clearDeployTimer(r);
        socket.to(r.code).emit('rank:cancelled', { reason: 'Đối thủ đã rời trận trước khi bắt đầu' });
      }
      void socket.leave(r.code);
      if (ALL_SIDES.every((sd) => !r.players[sd]?.socketId)) {
        r.cleanup ??= setTimeout(() => rooms.delete(r.code), 60_000);
      } else {
        void broadcast(r);
      }
      room = null;
      side = null;
    };

    const seat = (r: Room, s: Side) => {
      leave();
      room = r;
      side = s;
      void socket.join(r.code);
    };

    socket.on('rank:queue', async (ack) => {
      // Re-check the account (disabled while connected) and read its age fresh.
      const fresh = await deps.authenticate(socket.data.cookie).catch(() => null);
      if (!fresh) {
        ack({ ok: false, error: 'Phiên đăng nhập đã hết hạn hoặc tài khoản bị khóa' });
        return void socket.disconnect(true);
      }
      if (room?.battle) return ack({ ok: false, error: 'Bạn đang trong một trận đấu' });
      const entry = await deps.rankEntry(fresh).catch(() => null);
      if (!entry) return ack({ ok: false, error: 'Không tải được thông tin xếp hạng, thử lại sau' });
      if (entry.gate || !entry.season) return ack({ ok: false, error: entry.gate ?? 'Chế độ xếp hạng đang tạm đóng' });
      if (!socket.connected || room?.battle) return ack({ ok: false, error: 'Không vào được hàng chờ' });
      leave();
      queue.set(user.uid, { entry: { uid: user.uid, ip: clientIp(socket), steps: entry.steps, since: Date.now() }, socket, season: entry.season, name: playerName(user), rank: entry.rank, seat });
      matchTimer ??= setInterval(() => void matchmake(), MATCH_EVERY_MS);
      ack({ ok: true });
      void matchmake();
    });

    socket.on('rank:cancel', () => unqueue(user.uid, socket));

    socket.on('room:create', async (ack) => {
      const bundle = await getBundle();
      leave();
      const map = bundle.maps[0];
      if (!map) return ack({ ok: false, error: 'Chưa có bản đồ nào trong CMS' });
      const code = newCode();
      room = { code, phase: 'lobby', mapId: map.id, budget: map.budget, useStars: true, defense: null, players: { blue: { uid: user.uid, socketId: socket.id, name: playerName(user), ready: false, army: [], stars: {} } }, battle: null, cleanup: null, deployDeadline: null, deployTimer: null, ranked: null };
      side = 'blue';
      rooms.set(code, room);
      void socket.join(code);
      ack({ ok: true, code, side });
      void broadcast(room);
    });

    socket.on('room:join', async (req, ack) => {
      const code = typeof req?.code === 'string' ? req.code.trim().toUpperCase() : '';
      if (!code) return ack({ ok: false, error: 'Không tìm thấy phòng' });
      let target = rooms.get(code);
      if (!target) {
        // Room was closed or never existed: recreate it under the same code instead of erroring.
        const bundle = await getBundle();
        const map = bundle.maps[0];
        if (!map) return ack({ ok: false, error: 'Chưa có bản đồ nào trong CMS' });
        leave();
        target = { code, phase: 'lobby', mapId: map.id, budget: map.budget, useStars: true, defense: null, players: { blue: { uid: user.uid, socketId: socket.id, name: playerName(user), ready: false, army: [], stars: {} } }, battle: null, cleanup: null, deployDeadline: null, deployTimer: null, ranked: null };
        rooms.set(code, target);
        room = target;
        side = 'blue';
        void socket.join(code);
        ack({ ok: true, code, side: 'blue' });
        void broadcast(target);
        return;
      }
      // A seat belongs to its uid: rejoining reclaims it, and nobody plays against themself.
      const slots = ALL_SIDES.slice(0, seatCap(target));
      let mine: Side | null = slots.find((s) => target!.players[s]?.uid === user.uid) ?? null;
      // Ranked rooms: only the two matched players, and only until their one battle is over.
      if (target.ranked && !mine) return ack({ ok: false, error: 'Không thể vào phòng xếp hạng bằng mã' });
      if (target.ranked?.closed && !target.battle) return ack({ ok: false, error: 'Trận xếp hạng đã kết thúc' });
      if (!mine) mine = slots.find((s) => !target!.players[s]) ?? null;
      if (!mine) return ack({ ok: false, error: target.defense !== null ? 'Phòng đấu thủ thành chỉ có 2 người' : 'Phòng đã đủ 4 người' });
      if (room !== target || side !== mine) leave();
      const existing = target.players[mine];
      target.players[mine] = { uid: user.uid, socketId: socket.id, name: playerName(user), ready: false, army: existing?.army ?? [], stars: existing?.stars ?? {} };
      if (target.cleanup) {
        clearTimeout(target.cleanup);
        target.cleanup = null;
      }
      if (target.phase === 'battle' && !target.battle) target.phase = 'lobby';
      room = target;
      side = mine;
      void socket.join(code);
      ack({ ok: true, code, side: mine });
      void broadcast(target);
    });

    socket.on('room:settings', async (req) => {
      const bundle = await getBundle();
      if (!room || side !== 'blue' || room.phase !== 'lobby' || room.ranked) return;
      const parsed = z.object({ mapId: idSchema, budget: z.number().int().min(100).max(1_000_000), useStars: z.boolean(), defense: z.enum(['blue', 'red']).nullable().default(null) }).safeParse(req);
      if (!parsed.success) return;
      if (!bundle.maps.some((m) => m.id === parsed.data.mapId)) return;
      // Siege is a 2-side mode: it can't be turned on once a 3rd/4th seat is occupied.
      if (parsed.data.defense !== null && connectedSides(room).length > 2) return;
      room.mapId = parsed.data.mapId;
      room.budget = parsed.data.budget;
      room.useStars = parsed.data.useStars;
      room.defense = parsed.data.defense;
      for (const p of Object.values(room.players)) if (p) p.ready = false;
      clearDeployTimer(room);
      void broadcast(room);
    });

    socket.on('room:ready', async (req, ack) => {
      // Re-check the account: a user disabled while connected cannot start new battles.
      if (!(await deps.authenticate(socket.data.cookie).catch(() => null))) {
        ack({ ok: false, error: 'Phiên đăng nhập đã hết hạn hoặc tài khoản bị khóa' });
        return void socket.disconnect(true);
      }
      const [bundle, wallet] = await Promise.all([getBundle(), deps.loadPlayer(user.uid).catch(() => null)]);
      if (!room || !side || room.phase !== 'lobby') return ack({ ok: false, error: 'Không ở trong phòng chờ' });
      if (room.ranked?.closed) return ack({ ok: false, error: 'Trận xếp hạng đã kết thúc — hãy tìm trận mới' });
      if (!wallet) return ack({ ok: false, error: 'Không tải được bộ sưu tập lính, thử lại sau' });
      const army = armySchema.safeParse(req?.army);
      if (!army.success) return ack({ ok: false, error: 'Dữ liệu đội hình không hợp lệ' });
      const map = bundle.maps.find((m) => m.id === room!.mapId);
      if (!map) return ack({ ok: false, error: 'Bản đồ không còn tồn tại' });
      if (army.data.length === 0) return ack({ ok: false, error: 'Chưa đặt lính nào' });
      const check = validateArmy(bundle, new Terrain(map, bundle.assets, room.defense, connectedSides(room)), side, army.data, sideBudget(bundle.settings, room.budget, side, room.defense));
      if (!check.ok) return ack({ ok: false, error: check.error });
      const armyUnits = new Set(army.data.map((p) => p.unitId));
      const locked = bundle.units.find((u) => armyUnits.has(u.id) && !isUnlocked(u, wallet));
      if (locked) return ack({ ok: false, error: `Chưa mở khóa lính ${locked.name}` });
      // Readying for a new battle without confirming the last one abandons it.
      if (room.battle && !room.battle.reports[side]) voidBattle(room, `${room.players[side]!.name} bỏ dở trận, kết quả bị hủy`, 'Người chơi bỏ dở trận');
      const me = room.players[side]!;
      me.army = army.data;
      me.stars = Object.fromEntries([...armyUnits].flatMap((id) => (wallet.stars[id] ? [[id, wallet.stars[id]]] : [])));
      me.ready = true;
      ack({ ok: true });
      const active = connectedSides(room);
      if (active.length >= 2 && active.every((s) => room!.players[s]!.ready) && !room.battle) await startBattle(room, active);
      void broadcast(room);
    });

    socket.on('room:unready', () => {
      if (!room || !side || room.phase !== 'lobby') return;
      room.players[side]!.ready = false;
      void broadcast(room);
    });

    socket.on('room:draft', (req) => {
      if (!room || !side || room.phase !== 'lobby') return;
      const army = armySchema.safeParse(req?.army);
      if (!army.success) return;
      room.players[side]!.army = army.data;
      void broadcast(room);
    });

    socket.on('battle:checksum', (req) => {
      const battle = room?.battle;
      if (!room || !side || !battle || battle.reports[side]) return;
      const tick = Number(req?.tick);
      const hash = Number(req?.hash);
      // Only ticks a real simulation sends, which also bounds the map (≤ battleTimeLimit / 1 s entries).
      if (!Number.isInteger(tick) || tick <= 0 || tick % CHECKSUM_EVERY !== 0 || tick > battle.maxTick || !Number.isFinite(hash)) return;
      battle.lastTick[side] = Math.max(battle.lastTick[side] ?? 0, tick);
      if (battle.verified.has(tick)) return;
      const entry = battle.checksums.get(tick) ?? {};
      if (entry[side] !== undefined) return;
      entry[side] = hash;
      battle.checksums.set(tick, entry);
      if (!battle.activeSides.every((s) => entry[s] !== undefined)) return;
      battle.checksums.delete(tick);
      const hashes = new Set(battle.activeSides.map((s) => entry[s]));
      if (hashes.size === 1) battle.verified.add(tick);
      else if (!battle.desync) {
        battle.desync = true;
        io.to(room.code).emit('battle:desync', { tick });
      }
    });

    socket.on('battle:end', (req) => {
      const battle = room?.battle;
      if (!room || !side || !battle || battle.reports[side]) return;
      const parsed = z.object({ outcome: z.enum(['win', 'lose', 'draw']), tick: z.number().int().min(1).max(battle.maxTick) }).safeParse(req);
      if (!parsed.success) return voidBattle(room, 'Báo cáo kết quả không hợp lệ, kết quả bị hủy', 'Báo cáo kết quả không hợp lệ');
      battle.reports[side] = parsed.data;
      if (room.phase === 'battle') {
        room.phase = 'lobby';
        for (const p of Object.values(room.players)) if (p) p.ready = false;
        void broadcast(room);
      }
      void maybeSettle(room);
    });

    socket.on('battle:surrender', () => {
      if (!room || !side || !room.battle) return;
      void eliminate(room, side, false);
    });

    socket.on('room:leave', leave);
    socket.on('disconnect', () => {
      leave();
      if (online.get(user.uid) === socket) online.delete(user.uid);
    });
  });
}
