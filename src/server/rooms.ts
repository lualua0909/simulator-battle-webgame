// Online PvP rooms. The server never simulates: it validates both armies against the
// CMS content, picks a seed, and both browsers run the same deterministic battle.
// Periodic checksums from each side detect desyncs; a result is saved only when both
// players report the same end (see matches.ts).
//
// Hardening: only signed-in, enabled users from this site's origin connect; one live
// connection per account; per-socket event rate limit; malformed packets are dropped.
// Unit unlocks and star levels come from each player's Firestore wallet, never from the client.
import { randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { armyCost, armySchema, sideBudget, validateArmy, type Placement } from '@/game/sim/army';
import { SIM_HZ } from '@/game/sim/world';
import { Terrain, type Side } from '@/game/sim/terrain';
import { isUnlocked, type PlayerState } from '@/shared/economy';
import { UNAUTHORIZED, type ClientToServer, type RoomState, type ServerToClient } from '@/shared/net';
import { idSchema } from '@/shared/schema';
import type { AppUser } from '@/shared/users';
import { getBundle } from './content';
import { CHECKSUM_EVERY, judgeMatch, saveMatch, type BattleRecord } from './matches';
import { recordBattleResult, recordBattleStart, recordBattleVoid, recordSaveFailed, registerRooms } from './metrics';
import { getPlayer } from './players';
import { SESSION_COOKIE, userFromSessionCookie } from './users';

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
}

const rooms = new Map<string, Room>();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Socket.IO packet size cap: a 500-unit army is ~30 KB of JSON. */
export const MAX_PACKET_BYTES = 100_000;
const RATE_WINDOW_MS = 1000;
const RATE_MAX_EVENTS = 20;
/** Events whose last argument must be the ack callback. */
const ACK_EVENTS = new Set(['room:create', 'room:join', 'room:ready']);

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
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
  for (const side of ['blue', 'red'] as const) {
    const p = room.players[side];
    if (p) players[side] = { name: p.name, ready: p.ready, connected: p.socketId !== null, units: p.army.length, cost: armyCost(bundle, p.army) };
  }
  return { code: room.code, phase: room.phase, mapId: room.mapId, budget: room.budget, useStars: room.useStars, defense: room.defense, players };
}

export function attachRooms(io: RoomServer, deps: RoomDeps = { authenticate: userFromSessionCookie, saveMatch, loadPlayer: getPlayer }): void {
  /** Live socket per uid: a new connection replaces the old one. */
  const online = new Map<string, Sock>();

  const broadcast = async (room: Room) => {
    const state = await publicState(room);
    io.to(room.code).emit('room:state', state);
  };

  registerRooms(() => {
    const all = [...rooms.values()];
    return {
      sockets: online.size,
      rooms: all.length,
      lobbies: all.filter((r) => !r.battle).length,
      battles: all.flatMap((r) => (r.battle ? [{ code: r.code, blue: r.battle.players.blue.name, red: r.battle.players.red.name, mapId: r.battle.mapId, siege: r.battle.defense !== null, startedAt: r.battle.startedAt }] : [])),
    };
  });

  /** `kind` groups the void in monitoring (the error shown to players can contain names). */
  const voidBattle = (room: Room, error: string, kind: string) => {
    if (!room.battle) return;
    room.battle = null;
    recordBattleVoid(kind);
    io.to(room.code).emit('battle:result', { ok: false, error });
  };

  const settle = async (room: Room) => {
    const battle = room.battle!;
    room.battle = null;
    const verdict = judgeMatch(battle);
    if (!verdict.ok) {
      recordBattleVoid(verdict.error);
      return void io.to(room.code).emit('battle:result', verdict);
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
      if (!room || !side) return;
      const r = room;
      const p = r.players[side];
      if (p && p.socketId === socket.id) {
        p.socketId = null;
        p.ready = false;
      }
      if (r.battle && !r.battle.reports[side]) voidBattle(r, `${p?.name ?? 'Một người chơi'} rời trận, kết quả bị hủy`, 'Người chơi rời trận');
      void socket.leave(r.code);
      if (!r.players.blue?.socketId && !r.players.red?.socketId) {
        r.cleanup ??= setTimeout(() => rooms.delete(r.code), 60_000);
      } else {
        if (r.phase === 'battle') r.phase = 'lobby';
        void broadcast(r);
      }
      room = null;
      side = null;
    };

    socket.on('room:create', async (ack) => {
      const bundle = await getBundle();
      leave();
      const map = bundle.maps[0];
      if (!map) return ack({ ok: false, error: 'Chưa có bản đồ nào trong CMS' });
      const code = newCode();
      room = { code, phase: 'lobby', mapId: map.id, budget: map.budget, useStars: true, defense: null, players: { blue: { uid: user.uid, socketId: socket.id, name: playerName(user), ready: false, army: [], stars: {} } }, battle: null, cleanup: null };
      side = 'blue';
      rooms.set(code, room);
      void socket.join(code);
      ack({ ok: true, code, side });
      void broadcast(room);
    });

    socket.on('room:join', (req, ack) => {
      const code = typeof req?.code === 'string' ? req.code.trim().toUpperCase() : '';
      const target = rooms.get(code);
      if (!target) return ack({ ok: false, error: 'Không tìm thấy phòng' });
      // A seat belongs to its uid: rejoining reclaims it, and nobody plays against themself.
      let seat: Side | null = (['blue', 'red'] as const).find((s) => target.players[s]?.uid === user.uid) ?? null;
      if (!seat && !target.players.red) seat = 'red';
      if (!seat) return ack({ ok: false, error: 'Phòng đã đủ 2 người' });
      if (room !== target || side !== seat) leave();
      const existing = target.players[seat];
      target.players[seat] = { uid: user.uid, socketId: socket.id, name: playerName(user), ready: false, army: existing?.army ?? [], stars: existing?.stars ?? {} };
      if (target.cleanup) {
        clearTimeout(target.cleanup);
        target.cleanup = null;
      }
      if (target.phase === 'battle') target.phase = 'lobby';
      room = target;
      side = seat;
      void socket.join(code);
      ack({ ok: true, code, side: seat });
      void broadcast(target);
    });

    socket.on('room:settings', async (req) => {
      const bundle = await getBundle();
      if (!room || side !== 'blue' || room.phase !== 'lobby') return;
      const parsed = z.object({ mapId: idSchema, budget: z.number().int().min(100).max(1_000_000), useStars: z.boolean(), defense: z.enum(['blue', 'red']).nullable().default(null) }).safeParse(req);
      if (!parsed.success) return;
      if (!bundle.maps.some((m) => m.id === parsed.data.mapId)) return;
      room.mapId = parsed.data.mapId;
      room.budget = parsed.data.budget;
      room.useStars = parsed.data.useStars;
      room.defense = parsed.data.defense;
      for (const p of Object.values(room.players)) if (p) p.ready = false;
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
      if (!wallet) return ack({ ok: false, error: 'Không tải được bộ sưu tập lính, thử lại sau' });
      const army = armySchema.safeParse(req?.army);
      if (!army.success) return ack({ ok: false, error: 'Dữ liệu đội hình không hợp lệ' });
      const map = bundle.maps.find((m) => m.id === room!.mapId);
      if (!map) return ack({ ok: false, error: 'Bản đồ không còn tồn tại' });
      if (army.data.length === 0) return ack({ ok: false, error: 'Chưa đặt lính nào' });
      const check = validateArmy(bundle, new Terrain(map, bundle.assets, room.defense), side, army.data, sideBudget(bundle.settings, room.budget, side, room.defense));
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
      const { blue, red } = room.players;
      if (blue?.ready && red?.ready && blue.socketId && red.socketId && !room.battle) {
        room.phase = 'battle';
        const start = {
          seed: randomInt(1, 2 ** 31 - 1),
          mapId: room.mapId,
          budget: room.budget,
          armies: { blue: blue.army, red: red.army },
          useStars: room.useStars,
          defense: room.defense,
          stars: room.useStars ? { blue: blue.stars, red: red.stars } : { blue: {}, red: {} },
          configVersion: bundle.version,
        };
        room.battle = {
          ...start,
          code: room.code,
          players: { blue: { uid: blue.uid, name: blue.name }, red: { uid: red.uid, name: red.name } },
          startedAt: Date.now(),
          maxTick: Math.round(bundle.settings.battleTimeLimit * SIM_HZ),
          reports: {},
          checksums: new Map(),
          verified: new Set(),
          desync: false,
        };
        recordBattleStart();
        io.to(room.code).emit('battle:start', start);
      }
      void broadcast(room);
    });

    socket.on('room:unready', () => {
      if (!room || !side || room.phase !== 'lobby') return;
      room.players[side]!.ready = false;
      void broadcast(room);
    });

    socket.on('battle:checksum', (req) => {
      const battle = room?.battle;
      if (!room || !side || !battle || battle.reports[side]) return;
      const tick = Number(req?.tick);
      const hash = Number(req?.hash);
      // Only ticks a real simulation sends, which also bounds the map (≤ battleTimeLimit / 1 s entries).
      if (!Number.isInteger(tick) || tick <= 0 || tick % CHECKSUM_EVERY !== 0 || tick > battle.maxTick || !Number.isFinite(hash)) return;
      if (battle.verified.has(tick)) return;
      const entry = battle.checksums.get(tick) ?? {};
      if (entry[side] !== undefined) return;
      entry[side] = hash;
      battle.checksums.set(tick, entry);
      if (entry.blue === undefined || entry.red === undefined) return;
      battle.checksums.delete(tick);
      if (entry.blue === entry.red) battle.verified.add(tick);
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
      if (battle.reports.blue && battle.reports.red) void settle(room);
    });

    socket.on('room:leave', leave);
    socket.on('disconnect', () => {
      leave();
      if (online.get(user.uid) === socket) online.delete(user.uid);
    });
  });
}
