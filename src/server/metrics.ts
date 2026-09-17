// In-memory runtime metrics for the CMS monitoring screen (reset when the process restarts).
// server.ts, the Socket.IO rooms and Next.js route handlers load separate module
// instances in one Node process, so the store lives on globalThis (like db.ts).
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { ALL_SIDES, type Side } from '@/game/sim/terrain';

/** A user counts as active this long after their last authenticated request or socket handshake. */
export const ACTIVE_WINDOW_MS = 5 * 60_000;
const MAX_ROUTE_KEYS = 300;

export interface RoomsSnapshot {
  sockets: number;
  rooms: number;
  lobbies: number;
  battles: Array<{ code: string; players: Array<{ side: Side; name: string }>; mapId: string; siege: boolean; startedAt: number }>;
}

export interface RouteFailure {
  method: string;
  path: string;
  status: number;
  count: number;
  lastAt: number;
}

interface Store {
  startedAt: number;
  loopDelay: IntervalHistogram;
  http: { total: number; failed: number; routes: Map<string, RouteFailure> };
  activeUsers: Map<string, number>;
  logins: number;
  battles: { started: number; results: Record<Side | 'draw', number>; voided: Map<string, number>; saveFailed: number };
  rooms: (() => RoomsSnapshot) | null;
}

const g = globalThis as unknown as { __battleMetrics?: Store };

function store(): Store {
  if (!g.__battleMetrics) {
    const loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();
    g.__battleMetrics = {
      startedAt: Date.now(),
      loopDelay,
      http: { total: 0, failed: 0, routes: new Map() },
      activeUsers: new Map(),
      logins: 0,
      battles: { started: 0, results: { ...Object.fromEntries(ALL_SIDES.map((s) => [s, 0])), draw: 0 } as Record<Side | 'draw', number>, voided: new Map(), saveFailed: 0 },
      rooms: null,
    };
  }
  return g.__battleMetrics;
}

/** One finished /api request. Status ≥ 400 counts as a failure. */
export function recordHttp(method: string, path: string, status: number): void {
  const { http } = store();
  http.total++;
  if (status < 400) return;
  http.failed++;
  const at = Date.now();
  const key = `${method} ${path} ${status}`;
  const route = http.routes.get(key);
  if (route) {
    route.count++;
    route.lastAt = at;
  } else if (http.routes.size < MAX_ROUTE_KEYS) http.routes.set(key, { method, path, status, count: 1, lastAt: at });
}

export function recordActiveUser(uid: string): void {
  store().activeUsers.set(uid, Date.now());
}

export function recordLogin(): void {
  store().logins++;
}

export function recordBattleStart(): void {
  store().battles.started++;
}

export function recordBattleResult(winner: Side | 'draw'): void {
  store().battles.results[winner]++;
}

export function recordBattleVoid(reason: string): void {
  const { voided } = store().battles;
  voided.set(reason, (voided.get(reason) ?? 0) + 1);
}

export function recordSaveFailed(): void {
  store().battles.saveFailed++;
}

/** Called once by attachRooms so route handlers can read the live room state. */
export function registerRooms(snapshot: () => RoomsSnapshot): void {
  store().rooms = snapshot;
}

export function metricsSnapshot() {
  const s = store();
  const now = Date.now();
  for (const [uid, at] of s.activeUsers) if (now - at > ACTIVE_WINDOW_MS) s.activeUsers.delete(uid);
  const mem = process.memoryUsage();
  return {
    now,
    startedAt: s.startedAt,
    process: {
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      heapTotalMb: Math.round(mem.heapTotal / 1048576),
      eventLoopP99Ms: Math.round(s.loopDelay.percentile(99) / 1e6),
    },
    activeUsers: s.activeUsers.size,
    logins: s.logins,
    rooms: s.rooms?.() ?? null,
    http: {
      total: s.http.total,
      failed: s.http.failed,
      routes: [...s.http.routes.values()].sort((a, b) => b.count - a.count),
    },
    battles: {
      started: s.battles.started,
      results: s.battles.results,
      saveFailed: s.battles.saveFailed,
      voided: [...s.battles.voided].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    },
  };
}

export type MetricsSnapshot = ReturnType<typeof metricsSnapshot>;

/** Firestore totals shown next to the live metrics (see /api/admin/monitoring). */
export interface StoredStats {
  at: number;
  users: { total: number; loggedIn24h: number };
  matches: { total: number; last24h: number; blue: number; red: number; draw: number; siege: number };
}
