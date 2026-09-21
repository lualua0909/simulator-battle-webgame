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
  /** Sides deploying in this match, in seat order. */
  activeSides: Side[];
  useStars: boolean;
  /** Siege mode: the defending side (null = open battle). */
  defense: Side | null;
  stars: ArmyStars;
  players: Partial<Record<Side, MatchPlayer>>;
  startedAt: number;
  /** Last tick the simulation can reach (settings.battleTimeLimit). */
  maxTick: number;
  reports: Partial<Record<Side, { outcome: BattleOutcome; tick: number }>>;
  /** Checksums waiting for the other side, by tick. */
  checksums: Map<number, Partial<Record<Side, number>>>;
  /** Ticks every active side sent the same checksum for. */
  verified: Set<number>;
  /** Newest checksum tick each side sent: how far its own simulation has already run. */
  lastTick: Partial<Record<Side, number>>;
  desync: boolean;
  /** Sides that surrendered or disconnected (removed from the fight, authoritative on the server). */
  eliminated: Set<Side>;
  /** Eliminated sides that disconnected rather than surrendered: they can never send battle:end themselves. */
  disconnected: Set<Side>;
}

export type Verdict = { ok: true; winner: Side | 'draw'; tick: number } | { ok: false; error: string };

/**
 * Accepts only a consistent set of reports from every active side: same end tick, no desync,
 * every checksum matched, and either all report 'draw' or exactly one reports 'win' while every
 * other side reports 'lose'.
 */
export function judgeMatch(b: Pick<BattleRecord, 'activeSides' | 'reports' | 'verified' | 'desync'>): Verdict {
  const entries = b.activeSides.map((side) => [side, b.reports[side]] as const);
  const missing = entries.find(([, r]) => !r);
  if (missing) return { ok: false, error: 'Thiếu xác nhận kết quả của một bên' };
  const reports = entries as ReadonlyArray<readonly [Side, { outcome: BattleOutcome; tick: number }]>;
  if (b.desync) return { ok: false, error: 'Các máy lệch trận (desync)' };
  const tick = reports[0][1].tick;
  if (reports.some(([, r]) => r.tick !== tick)) return { ok: false, error: 'Các máy kết thúc trận ở thời điểm khác nhau' };
  for (let t = CHECKSUM_EVERY; t <= tick; t += CHECKSUM_EVERY) {
    if (!b.verified.has(t)) return { ok: false, error: 'Thiếu checksum để đối chiếu trận' };
  }
  if (reports.every(([, r]) => r.outcome === 'draw')) return { ok: true, winner: 'draw', tick };
  const winners = reports.filter(([, r]) => r.outcome === 'win');
  const losers = reports.filter(([, r]) => r.outcome === 'lose');
  if (winners.length === 1 && losers.length === reports.length - 1) return { ok: true, winner: winners[0][0], tick };
  return { ok: false, error: 'Báo cáo kết quả các bên không khớp nhau' };
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
      activeSides: b.activeSides,
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
