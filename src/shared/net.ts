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
  players: Partial<Record<Side, NetPlayer>>;
}

export interface BattleStart {
  seed: number;
  mapId: string;
  budget: number;
  armies: Armies;
  configVersion: string;
}

export type AckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServer {
  'room:create': (req: { name: string }, ack: (res: AckResult<{ code: string; side: Side; token: string }>) => void) => void;
  'room:join': (req: { code: string; name: string; token?: string }, ack: (res: AckResult<{ code: string; side: Side; token: string }>) => void) => void;
  'room:settings': (req: { mapId: string; budget: number }) => void;
  'room:ready': (req: { army: Placement[] }, ack: (res: AckResult) => void) => void;
  'room:unready': () => void;
  'room:leave': () => void;
  'battle:checksum': (req: { tick: number; hash: number }) => void;
  'battle:end': (req: { winner: Side | 'draw' }) => void;
}

export interface ServerToClient {
  'room:state': (state: RoomState) => void;
  'battle:start': (start: BattleStart) => void;
  'battle:desync': (info: { tick: number }) => void;
}
