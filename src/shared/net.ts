// Socket.IO protocol shared by the online room server and the browser client.
import type { Armies, Placement } from '@/game/sim/army';
import type { Side } from '@/game/sim/terrain';
import type { RankState } from './economy';
import type { RankResult } from './ranked';

export interface NetPlayer {
  name: string;
  ready: boolean;
  connected: boolean;
  units: number;
  cost: number;
  /** This seat's army budget before siege scaling: the player's level budget (ranked: the map's). */
  budget: number;
}

export interface RoomState {
  code: string;
  phase: 'lobby' | 'battle';
  mapId: string;
  /** Map budget: the budget of both seats of a ranked room (casual seats use their own level budget). */
  budget: number;
  /** Host setting: upgraded units fight with their star bonus. */
  useStars: boolean;
  /** Host setting: siege mode with this side defending (null = open battle). */
  defense: Side | null;
  players: Partial<Record<Side, NetPlayer>>;
  /** Deployment countdown deadline (epoch ms); null before 2 players are connected or once the battle has started. */
  deadline: number | null;
  /** Season id of a matchmade ranked room (fixed settings, one battle); null for a room joined by code. */
  ranked: string | null;
}

export interface RoomSettings {
  mapId: string;
  useStars: boolean;
  defense: Side | null;
}

/** Star level per unit id, for each side. */
export type ArmyStars = Record<Side, Record<string, number>>;

export interface BattleStart {
  seed: number;
  mapId: string;
  budget: number;
  armies: Armies;
  /** Sides deploying in this match, in seat order (2 = classic 1v1, 3-4 = free-for-all). */
  activeSides: Side[];
  useStars: boolean;
  /** Siege mode: the defending side (null = open battle). */
  defense: Side | null;
  /** Read by the server from each player's collection when they got ready; empty when stars are off. */
  stars: ArmyStars;
  configVersion: string;
}

export type AckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Ranked matchmaking found an opponent: the server has already seated you in the room. */
export interface RankMatched {
  code: string;
  side: Side;
  opponent: { name: string; rank: RankState | null };
}

/** A battle's end as seen by the reporting player. */
export type BattleOutcome = 'win' | 'lose' | 'draw';

/** Socket.IO handshake error when the session cookie is missing, invalid or disabled. */
export const UNAUTHORIZED = 'unauthorized';

// Players are signed-in users: the server takes identity and name from the session cookie,
// and a seat belongs to the uid that took it (reconnecting reclaims it).
export interface ClientToServer {
  'room:create': (ack: (res: AckResult<{ code: string; side: Side }>) => void) => void;
  'room:join': (req: { code: string }, ack: (res: AckResult<{ code: string; side: Side }>) => void) => void;
  'room:settings': (req: RoomSettings) => void;
  'room:ready': (req: { army: Placement[] }, ack: (res: AckResult) => void) => void;
  'room:unready': () => void;
  /** Live army edits while still deploying, so a 30s timeout can force-start with the latest draft. */
  'room:draft': (req: { army: Placement[] }) => void;
  'room:leave': () => void;
  'battle:checksum': (req: { tick: number; hash: number }) => void;
  'battle:end': (req: { outcome: BattleOutcome; tick: number }) => void;
  /** Concedes the running battle: that side is eliminated, the rest keep fighting. */
  'battle:surrender': () => void;
  /** Ranked matchmaking queue (refused with the reason when the player may not queue). */
  'rank:queue': (ack: (res: AckResult) => void) => void;
  'rank:cancel': () => void;
}

export interface ServerToClient {
  'room:state': (state: RoomState) => void;
  'battle:start': (start: BattleStart) => void;
  'battle:desync': (info: { tick: number }) => void;
  /** A side is eliminated (surrender or disconnect) at a future tick every client applies identically. */
  'battle:eliminate': (info: { side: Side; tick: number }) => void;
  /** Saved once every side's report agrees; otherwise the result is voided with the reason. */
  'battle:result': (res: AckResult<{ winner: Side | 'draw' }>) => void;
  'rank:matched': (match: RankMatched) => void;
  /** The matched ranked battle was called off before it started (the opponent left). */
  'rank:cancelled': (info: { reason: string }) => void;
  /** What the ranked battle did to your standing, or why it did not count. */
  'rank:result': (res: AckResult<RankResult>) => void;
}
