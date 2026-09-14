// Socket.IO rooms end to end: a real server and clients, with sign-in and Firestore faked.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { Terrain } from '@/game/sim/terrain';
import { emptyPlayer, type PlayerState } from '@/shared/economy';
import type { AckResult, BattleStart, ClientToServer, ServerToClient } from '@/shared/net';
import { SEED } from '@/shared/seed';
import { ROLE, type AppUser } from '@/shared/users';
import type { BattleRecord } from './matches';
import { allowSocketRequest, attachRooms, MAX_PACKET_BYTES, type RoomServer } from './rooms';

type Client = Socket<ServerToClient, ClientToServer>;

const user = (uid: string): AppUser => ({ uid, email: `${uid}@test.dev`, displayName: uid, photoURL: null, role: ROLE.user, providers: [], disabled: false, fcmTokens: [], createdAt: null, updatedAt: null, lastLoginAt: null });
const USERS: Record<string, AppUser> = { 'cookie-alice': user('alice'), 'cookie-bob': user('bob'), 'cookie-carol': user('carol') };
const WALLETS: Record<string, PlayerState> = {
  alice: { ...emptyPlayer(), stars: { clubber: 3, archer: 2 } },
  carol: { ...emptyPlayer(), unlocked: ['knight'] },
};
const saved: Array<{ battle: BattleRecord; winner: string; tick: number }> = [];

let io: RoomServer;
let url = '';
const clients: Client[] = [];

before(async () => {
  const http = createServer();
  io = new Server(http, { maxHttpBufferSize: MAX_PACKET_BYTES, allowRequest: allowSocketRequest });
  attachRooms(io, {
    authenticate: async (cookie) => (cookie ? USERS[cookie] ?? null : null),
    saveMatch: async (battle, winner, tick) => void saved.push({ battle, winner, tick }),
    loadPlayer: async (uid) => WALLETS[uid] ?? emptyPlayer(),
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  url = `http://localhost:${(http.address() as AddressInfo).port}`;
});

after(() => {
  for (const c of clients) c.disconnect();
  void io.close();
  // content.ts keeps retrying Firestore (no credentials in tests) on a timer.
  setImmediate(() => process.exit(0));
});

function open(cookie: string | null, origin = url): Client {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { origin, ...(cookie && { cookie: `sb_session=${cookie}` }) } });
  clients.push(c);
  return c;
}

const connected = (c: Client) => new Promise<void>((resolve, reject) => (c.once('connect', resolve), c.once('connect_error', reject)));
const once = <E extends keyof ServerToClient>(c: Client, event: E) => new Promise<Parameters<ServerToClient[E]>[0]>((resolve) => c.once(event, ((arg: never) => resolve(arg)) as never));
const create = (c: Client) => new Promise<AckResult<{ code: string; side: string }>>((resolve) => c.emit('room:create', resolve));
const join = (c: Client, code: string) => new Promise<AckResult<{ code: string; side: string }>>((resolve) => c.emit('room:join', { code }, resolve));
const ready = (c: Client, side: 'blue' | 'red', unitId = SEED.units[0].id) => {
  const zone = new Terrain(SEED.maps[0], SEED.assets).zones[side];
  const army = [{ unitId, x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 }];
  return new Promise<AckResult>((resolve) => c.emit('room:ready', { army }, resolve));
};

/** Alice (blue) and Bob (red) in a fresh room with a battle started. */
async function startBattle(aliceCookie = 'cookie-alice', bobCookie = 'cookie-bob') {
  const alice = open(aliceCookie);
  const bob = open(bobCookie);
  await Promise.all([connected(alice), connected(bob)]);
  const room = await create(alice);
  assert.ok(room.ok);
  assert.deepEqual(await join(bob, room.code), { ok: true, code: room.code, side: 'red' });
  const started = Promise.all([once(alice, 'battle:start'), once(bob, 'battle:start')]);
  assert.deepEqual(await ready(alice, 'blue'), { ok: true });
  assert.deepEqual(await ready(bob, 'red'), { ok: true });
  const [start] = (await started) as BattleStart[];
  return { alice, bob, code: room.code, start };
}

function close(...cs: Client[]) {
  for (const c of cs) c.disconnect();
}

test('handshake needs a valid session cookie and this site as origin', async () => {
  await assert.rejects(connected(open(null)), /unauthorized/);
  await assert.rejects(connected(open('cookie-forged')), /unauthorized/);
  await assert.rejects(connected(open('cookie-carol', 'https://evil.example')));
  const ok = open('cookie-carol');
  await connected(ok);
  close(ok);
});

test('a packet without its ack callback is dropped instead of crashing the server', async () => {
  const c = open('cookie-carol');
  await connected(c);
  const raw = c as unknown as { emit(event: string, ...args: unknown[]): void };
  raw.emit('room:join', { code: 'NOPE' });
  raw.emit('room:create');
  assert.equal((await join(c, 'NOPE')).ok, false);
  close(c);
});

test('flooding events disconnects the socket', async () => {
  const c = open('cookie-carol');
  await connected(c);
  const dropped = once(c, 'disconnect' as never);
  for (let i = 0; i < 40; i++) c.emit('room:unready');
  assert.equal(await dropped, 'io server disconnect');
});

test('a second connection of the same account replaces the first', async () => {
  const first = open('cookie-carol');
  await connected(first);
  const dropped = once(first, 'disconnect' as never);
  const second = open('cookie-carol');
  await connected(second);
  assert.equal(await dropped, 'io server disconnect');
  close(second);
});

test('joining your own room gives your seat back, not the opponent seat', async () => {
  const c = open('cookie-carol');
  await connected(c);
  const room = await create(c);
  assert.ok(room.ok);
  assert.deepEqual(await join(c, room.code), { ok: true, code: room.code, side: 'blue' });
  close(c);
});

test('win + lose from both players is saved with the server-side battle data', async () => {
  const { alice, bob, code, start } = await startBattle();
  for (const tick of [30, 60]) {
    alice.emit('battle:checksum', { tick, hash: tick * 7 });
    bob.emit('battle:checksum', { tick, hash: tick * 7 });
  }
  const results = Promise.all([once(alice, 'battle:result'), once(bob, 'battle:result')]);
  alice.emit('battle:end', { outcome: 'win', tick: 75 });
  bob.emit('battle:end', { outcome: 'lose', tick: 75 });
  assert.deepEqual(await results, [
    { ok: true, winner: 'blue' },
    { ok: true, winner: 'blue' },
  ]);
  const match = saved.at(-1)!;
  assert.equal(match.winner, 'blue');
  assert.equal(match.tick, 75);
  assert.equal(match.battle.code, code);
  assert.equal(match.battle.seed, start.seed);
  assert.deepEqual(match.battle.players, { blue: { uid: 'alice', name: 'alice' }, red: { uid: 'bob', name: 'bob' } });
  assert.deepEqual(match.battle.armies, start.armies);
  assert.deepEqual(match.battle.stars, start.stars);
  close(alice, bob);
});

test('star levels come from the wallets of the army units while the host keeps stars on', async () => {
  const { alice, bob, start } = await startBattle();
  assert.equal(start.useStars, true);
  assert.deepEqual(start.stars, { blue: { clubber: 3 }, red: {} });
  close(alice, bob);

  const host = open('cookie-alice');
  const guest = open('cookie-bob');
  await Promise.all([connected(host), connected(guest)]);
  const room = await create(host);
  assert.ok(room.ok);
  await join(guest, room.code);
  const off = new Promise<void>((resolve) => host.on('room:state', (s) => s.useStars === false && resolve()));
  host.emit('room:settings', { mapId: SEED.maps[0].id, budget: SEED.maps[0].budget, useStars: false });
  await off;
  const started = once(guest, 'battle:start');
  await ready(host, 'blue');
  await ready(guest, 'red');
  const plain = await started;
  assert.equal(plain.useStars, false);
  assert.deepEqual(plain.stars, { blue: {}, red: {} });
  close(host, guest);
});

test('a unit missing from the player collection cannot be readied', async () => {
  const bob = open('cookie-bob');
  const carol = open('cookie-carol');
  await Promise.all([connected(bob), connected(carol)]);
  const room = await create(carol);
  assert.ok(room.ok);
  await join(bob, room.code);
  assert.deepEqual(await ready(bob, 'red', 'knight'), { ok: false, error: 'Chưa mở khóa lính Hiệp sĩ' });
  assert.deepEqual(await ready(carol, 'blue', 'knight'), { ok: true });
  close(bob, carol);
});

test('both claiming victory voids the result and saves nothing', async () => {
  const { alice, bob } = await startBattle();
  const before = saved.length;
  const result = once(alice, 'battle:result');
  alice.emit('battle:end', { outcome: 'win', tick: 20 });
  bob.emit('battle:end', { outcome: 'win', tick: 20 });
  assert.deepEqual(await result, { ok: false, error: 'Cả hai bên cùng báo thắng' });
  assert.equal(saved.length, before);
  close(alice, bob);
});

test('a checksum mismatch voids an otherwise consistent result', async () => {
  const { alice, bob } = await startBattle();
  const before = saved.length;
  const desync = once(bob, 'battle:desync');
  alice.emit('battle:checksum', { tick: 30, hash: 1 });
  bob.emit('battle:checksum', { tick: 30, hash: 2 });
  assert.deepEqual(await desync, { tick: 30 });
  const result = once(alice, 'battle:result');
  alice.emit('battle:end', { outcome: 'lose', tick: 40 });
  bob.emit('battle:end', { outcome: 'win', tick: 40 });
  assert.deepEqual(await result, { ok: false, error: 'Hai máy lệch trận (desync)' });
  assert.equal(saved.length, before);
  close(alice, bob);
});

test('leaving before confirming voids the result for the other player', async () => {
  const { alice, bob } = await startBattle();
  const before = saved.length;
  alice.emit('battle:end', { outcome: 'win', tick: 20 });
  const result = once(alice, 'battle:result');
  bob.disconnect();
  assert.deepEqual(await result, { ok: false, error: 'bob rời trận, kết quả bị hủy' });
  assert.equal(saved.length, before);
  close(alice);
});
