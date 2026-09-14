// Online match results: both players must report the same end of the battle before it is saved.
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Armies } from '@/game/sim/army';
import type { Side } from '@/game/sim/terrain';
import type { ArmyStars, BattleOutcome } from '@/shared/net';
import { firestore } from './firebase';

export const MATCHES_COLLECTION = 'matches';
/** Clients send a checksum every this many ticks (see BattleEngine). */
export const CHECKSUM_EVERY = 30;

export interface MatchPlayer {
  uid: string;
  name: string;
}

/** One running online battle, from battle:start until it is saved or voided. */
export interface BattleRecord {
  code: string;
  seed: number;
  mapId: string;
  budget: number;
  configVersion: string;
  armies: Armies;
  useStars: boolean;
  /** Siege mode: the defending side (null = open battle). */
  defense: Side | null;
  stars: ArmyStars;
  players: Record<Side, MatchPlayer>;
  startedAt: number;
  /** Last tick the simulation can reach (settings.battleTimeLimit). */
  maxTick: number;
  reports: Partial<Record<Side, { outcome: BattleOutcome; tick: number }>>;
  /** Checksums waiting for the other side, by tick. */
  checksums: Map<number, Partial<Record<Side, number>>>;
  /** Ticks both sides sent the same checksum for. */
  verified: Set<number>;
  desync: boolean;
}

export type Verdict = { ok: true; winner: Side | 'draw'; tick: number } | { ok: false; error: string };

/** Accepts only a consistent pair of reports: win/lose or draw/draw, same end tick, no desync, every checksum matched. */
export function judgeMatch(b: Pick<BattleRecord, 'reports' | 'verified' | 'desync'>): Verdict {
  const { blue, red } = b.reports;
  if (!blue || !red) return { ok: false, error: 'Thiếu xác nhận kết quả của một bên' };
  if (b.desync) return { ok: false, error: 'Hai máy lệch trận (desync)' };
  if (blue.tick !== red.tick) return { ok: false, error: 'Hai máy kết thúc trận ở thời điểm khác nhau' };
  for (let t = CHECKSUM_EVERY; t <= blue.tick; t += CHECKSUM_EVERY) {
    if (!b.verified.has(t)) return { ok: false, error: 'Thiếu checksum để đối chiếu trận' };
  }
  const pair = `${blue.outcome}/${red.outcome}`;
  if (pair === 'win/lose') return { ok: true, winner: 'blue', tick: blue.tick };
  if (pair === 'lose/win') return { ok: true, winner: 'red', tick: blue.tick };
  if (pair === 'draw/draw') return { ok: true, winner: 'draw', tick: blue.tick };
  if (pair === 'win/win') return { ok: false, error: 'Cả hai bên cùng báo thắng' };
  if (pair === 'lose/lose') return { ok: false, error: 'Cả hai bên cùng báo thua' };
  return { ok: false, error: 'Một bên báo hòa, bên kia báo thắng/thua' };
}

export async function saveMatch(b: BattleRecord, winner: Side | 'draw', tick: number): Promise<void> {
  await firestore()
    .collection(MATCHES_COLLECTION)
    .add({
      room: b.code,
      seed: b.seed,
      mapId: b.mapId,
      budget: b.budget,
      configVersion: b.configVersion,
      players: b.players,
      armies: b.armies,
      useStars: b.useStars,
      defense: b.defense,
      stars: b.stars,
      winner,
      endTick: tick,
      startedAt: Timestamp.fromMillis(b.startedAt),
      endedAt: FieldValue.serverTimestamp(),
    });
}
