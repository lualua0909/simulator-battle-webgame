// Online PvP rooms. The server never simulates: it validates both armies against the
// CMS content, picks a seed, and both browsers run the same deterministic battle.
// Periodic checksums from each side detect desyncs.
import { randomBytes, randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { armyCost, armySchema, validateArmy, type Placement } from '@/game/sim/army';
import { Terrain, type Side } from '@/game/sim/terrain';
import type { ClientToServer, RoomState, ServerToClient } from '@/shared/net';
import { idSchema } from '@/shared/schema';
import { getBundle } from './content';

interface Player {
  socketId: string | null;
  token: string;
  name: string;
  ready: boolean;
  army: Placement[];
}

interface Room {
  code: string;
  phase: 'lobby' | 'battle';
  mapId: string;
  budget: number;
  players: Partial<Record<Side, Player>>;
  checksums: Map<number, Partial<Record<Side, number>>>;
  cleanup: NodeJS.Timeout | null;
}

type IO = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient>;

const rooms = new Map<string, Room>();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const nameSchema = z.string().trim().min(1).max(20);

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

async function publicState(room: Room): Promise<RoomState> {
  const bundle = await getBundle();
  const players: RoomState['players'] = {};
  for (const side of ['blue', 'red'] as const) {
    const p = room.players[side];
    if (p) players[side] = { name: p.name, ready: p.ready, connected: p.socketId !== null, units: p.army.length, cost: armyCost(bundle, p.army) };
  }
  return { code: room.code, phase: room.phase, mapId: room.mapId, budget: room.budget, players };
}

export function attachRooms(io: IO): void {
  const broadcast = async (room: Room) => {
    const state = await publicState(room);
    io.to(room.code).emit('room:state', state);
  };

  io.on('connection', (socket: Sock) => {
    let room: Room | null = null;
    let side: Side | null = null;

    const leave = () => {
      if (!room || !side) return;
      const p = room.players[side];
      if (p && p.socketId === socket.id) {
        p.socketId = null;
        p.ready = false;
      }
      void socket.leave(room.code);
      const r = room;
      if (!r.players.blue?.socketId && !r.players.red?.socketId) {
        r.cleanup ??= setTimeout(() => rooms.delete(r.code), 60_000);
      } else {
        if (r.phase === 'battle') r.phase = 'lobby';
        void broadcast(r);
      }
      room = null;
      side = null;
    };

    socket.on('room:create', async (req, ack) => {
      const bundle = await getBundle();
      const name = nameSchema.safeParse(req?.name);
      if (!name.success) return ack({ ok: false, error: 'Tên không hợp lệ' });
      leave();
      const map = bundle.maps[0];
      if (!map) return ack({ ok: false, error: 'Chưa có bản đồ nào trong CMS' });
      const code = newCode();
      const token = randomBytes(12).toString('hex');
      room = { code, phase: 'lobby', mapId: map.id, budget: map.budget, players: { blue: { socketId: socket.id, token, name: name.data, ready: false, army: [] } }, checksums: new Map(), cleanup: null };
      side = 'blue';
      rooms.set(code, room);
      void socket.join(code);
      ack({ ok: true, code, side, token });
      void broadcast(room);
    });

    socket.on('room:join', (req, ack) => {
      const name = nameSchema.safeParse(req?.name);
      const code = typeof req?.code === 'string' ? req.code.trim().toUpperCase() : '';
      if (!name.success) return ack({ ok: false, error: 'Tên không hợp lệ' });
      const target = rooms.get(code);
      if (!target) return ack({ ok: false, error: 'Không tìm thấy phòng' });
      let seat: Side | null = null;
      for (const s of ['blue', 'red'] as const) {
        const p = target.players[s];
        if (p && !p.socketId && req.token && p.token === req.token) seat = s;
      }
      if (!seat && !target.players.red) seat = 'red';
      if (!seat) return ack({ ok: false, error: 'Phòng đã đủ 2 người' });
      leave();
      const existing = target.players[seat];
      const token = existing?.token ?? randomBytes(12).toString('hex');
      target.players[seat] = { socketId: socket.id, token, name: name.data, ready: false, army: existing?.army ?? [] };
      if (target.cleanup) {
        clearTimeout(target.cleanup);
        target.cleanup = null;
      }
      if (target.phase === 'battle') target.phase = 'lobby';
      room = target;
      side = seat;
      void socket.join(code);
      ack({ ok: true, code, side: seat, token });
      void broadcast(target);
    });

    socket.on('room:settings', async (req) => {
      const bundle = await getBundle();
      if (!room || side !== 'blue' || room.phase !== 'lobby') return;
      const parsed = z.object({ mapId: idSchema, budget: z.number().int().min(100).max(1_000_000) }).safeParse(req);
      if (!parsed.success) return;
      if (!bundle.maps.some((m) => m.id === parsed.data.mapId)) return;
      room.mapId = parsed.data.mapId;
      room.budget = parsed.data.budget;
      for (const p of Object.values(room.players)) if (p) p.ready = false;
      void broadcast(room);
    });

    socket.on('room:ready', async (req, ack) => {
      const bundle = await getBundle();
      if (!room || !side || room.phase !== 'lobby') return ack({ ok: false, error: 'Không ở trong phòng chờ' });
      const army = armySchema.safeParse(req?.army);
      if (!army.success) return ack({ ok: false, error: 'Dữ liệu đội hình không hợp lệ' });
      const map = bundle.maps.find((m) => m.id === room!.mapId);
      if (!map) return ack({ ok: false, error: 'Bản đồ không còn tồn tại' });
      if (army.data.length === 0) return ack({ ok: false, error: 'Chưa đặt lính nào' });
      const check = validateArmy(bundle, new Terrain(map, bundle.assets), side, army.data, room.budget);
      if (!check.ok) return ack({ ok: false, error: check.error });
      const me = room.players[side]!;
      me.army = army.data;
      me.ready = true;
      ack({ ok: true });
      const { blue, red } = room.players;
      if (blue?.ready && red?.ready && blue.socketId && red.socketId) {
        room.phase = 'battle';
        room.checksums.clear();
        io.to(room.code).emit('battle:start', {
          seed: randomInt(1, 2 ** 31 - 1),
          mapId: room.mapId,
          budget: room.budget,
          armies: { blue: blue.army, red: red.army },
          configVersion: bundle.version,
        });
      }
      void broadcast(room);
    });

    socket.on('room:unready', () => {
      if (!room || !side || room.phase !== 'lobby') return;
      room.players[side]!.ready = false;
      void broadcast(room);
    });

    socket.on('battle:checksum', (req) => {
      if (!room || !side || room.phase !== 'battle') return;
      const tick = Number(req?.tick);
      const hash = Number(req?.hash);
      if (!Number.isInteger(tick) || !Number.isFinite(hash)) return;
      const entry = room.checksums.get(tick) ?? {};
      entry[side] = hash;
      room.checksums.set(tick, entry);
      if (entry.blue !== undefined && entry.red !== undefined) {
        if (entry.blue !== entry.red) io.to(room.code).emit('battle:desync', { tick });
        room.checksums.delete(tick);
      }
      if (room.checksums.size > 200) room.checksums.delete(room.checksums.keys().next().value!);
    });

    socket.on('battle:end', () => {
      if (!room || room.phase !== 'battle') return;
      room.phase = 'lobby';
      for (const p of Object.values(room.players)) if (p) p.ready = false;
      void broadcast(room);
    });

    socket.on('room:leave', leave);
    socket.on('disconnect', leave);
  });
}
