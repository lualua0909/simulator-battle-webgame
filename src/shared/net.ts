// Socket.IO protocol shared by the online room server and the browser client.
import type { Armies, Placement } from '@/game/sim/army';
import type { Side } from '@/game/sim/terrain';

export interface NetPlayer {
  name: string;
  ready: boolean;
  connected: boolean;
  units: number;
  cost: number;
}

export interface RoomState {
  code: string;
  phase: 'lobby' | 'battle';
  mapId: string;
  budget: number;
  /** Host setting: upgraded units fight with their star bonus. */
  useStars: boolean;
  /** Host setting: siege mode with this side defending (null = open battle). */
  defense: Side | null;
  players: Partial<Record<Side, NetPlayer>>;
}

export interface RoomSettings {
  mapId: string;
  budget: number;
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
  useStars: boolean;
  /** Siege mode: the defending side (null = open battle). */
  defense: Side | null;
  /** Read by the server from each player's collection when they got ready; empty when stars are off. */
  stars: ArmyStars;
  configVersion: string;
}

export type AckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

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
  'room:leave': () => void;
  'battle:checksum': (req: { tick: number; hash: number }) => void;
  'battle:end': (req: { outcome: BattleOutcome; tick: number }) => void;
}

export interface ServerToClient {
  'room:state': (state: RoomState) => void;
  'battle:start': (start: BattleStart) => void;
  'battle:desync': (info: { tick: number }) => void;
  /** Saved once both reports agree; otherwise the result is voided with the reason. */
  'battle:result': (res: AckResult<{ winner: Side | 'draw' }>) => void;
}
