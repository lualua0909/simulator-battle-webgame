// Ranked mode on Firestore. The standing lives in the wallet (`players/{uid}.ranked`, changed in the
// same transaction as a win box); `ranked_seasons/{season}/standings/{uid}` mirrors it for the
// leaderboard, `ranked_pairs/{a__b}` counts today's battles of each pair of accounts, and
// `ranked_flags` keeps the suspicious battles for the admins. Rules: src/shared/ranked.ts.
import { FieldValue, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import type { Side } from '@/game/sim/terrain';
import { vnDay, type RankState } from '@/shared/economy';
import {
  currentSeason,
  judgeRanked,
  pairKey,
  pendingSeasonReward,
  RANKED_FLAGS,
  RANKED_PAIRS,
  RANKED_STANDINGS,
  rankedGate,
  rankScore,
  rankSteps,
  rollSeason,
  settleRankedPlayer,
  type RankedMatch,
  type RankFlagDoc,
  type RankResult,
  type RankView,
  type StandingRow,
} from '@/shared/ranked';
import type { AppUser } from '@/shared/users';
import { getContent } from './content';
import { firestore } from './firebase';
import { getPlayer, parse, players, random, writeChange } from './players';

const standings = (season: string) => firestore().collection(RANKED_STANDINGS).doc(season).collection('standings');

/** What the ranked lobby shows: season, standing (already carried into this season), pending season box, and whether the player may queue. */
export async function rankView(user: Pick<AppUser, 'uid' | 'createdAt'>): Promise<RankView> {
  const [player, content] = await Promise.all([getPlayer(user.uid), getContent()]);
  const cfg = content.settings.ranked;
  const now = Date.now();
  const season = currentSeason(cfg, now);
  return {
    season,
    rank: season ? rollSeason(player.ranked, season.id, cfg).state : player.ranked,
    pending: pendingSeasonReward(player, season, cfg),
    gate: rankedGate({ createdAt: user.createdAt, player, season, cfg, now }),
    botWins: player.botWinTotal,
    now,
  };
}

/** A player about to queue: current season, standing, matchmaking steps and the reason they may not queue (if any). */
export async function rankEntry(user: Pick<AppUser, 'uid' | 'createdAt'>): Promise<{ season: string | null; rank: RankState | null; steps: number; gate: string | null }> {
  const [view, content] = await Promise.all([rankView(user), getContent()]);
  return { season: view.season?.id ?? null, rank: view.rank, steps: view.rank ? rankSteps(view.rank, content.settings.ranked) : 0, gate: view.gate };
}

export interface RankSettleInput {
  season: string;
  room: string;
  match: Omit<RankedMatch, 'pairCount'>;
  names: Partial<Record<Side, string>>;
}

export interface RankSettlement {
  sides: Partial<Record<Side, RankResult>>;
  /** Ranked battles of this pair today, including this one (voided ones do not count). */
  pairCount: number;
}

/**
 * Applies a finished ranked battle to both wallets in one transaction: verdict (with today's pair
 * count read inside it), standings, win boxes, the pair counter and a flag for the admins when
 * anything looks off. Null when the battle's season is over (it no longer counts).
 */
export async function settleRanked(input: RankSettleInput): Promise<RankSettlement | null> {
  const content = await getContent();
  const cfg = content.settings.ranked;
  const now = Date.now();
  const season = currentSeason(cfg, now);
  if (!season || season.id !== input.season) return null;
  const sides = Object.keys(input.match.sides) as Side[];
  const uids = sides.map((s) => input.match.sides[s]!.uid);
  const db = firestore();
  const pairRef = db.collection(RANKED_PAIRS).doc(pairKey(uids[0], uids[1]));
  const refs = uids.map((uid) => players().doc(uid));
  const today = vnDay(now);
  return db.runTransaction(async (tx) => {
    const [pairSnap, ...snaps] = await tx.getAll(pairRef, ...refs);
    const pairCount = pairSnap.get('day') === today ? Number(pairSnap.get('count') ?? 0) : 0;
    const verdict = judgeRanked({ ...input.match, pairCount }, cfg);
    const out: Partial<Record<Side, RankResult>> = {};
    sides.forEach((side, i) => {
      const player = parse(snaps[i].data());
      const before = rollSeason(player.ranked, season.id, cfg).state;
      const change = settleRankedPlayer(player, season, verdict.sides[side]!, cfg, content.units, now, random);
      writeChange(tx, refs[i], snaps[i], change);
      const after = change.state.ranked!;
      tx.set(standings(season.id).doc(uids[i]), {
        name: input.names[side] ?? '?',
        tier: after.tier,
        cls: after.cls,
        diamonds: after.diamonds,
        points: after.points,
        wins: after.wins,
        losses: after.losses,
        score: rankScore(after, cfg),
        updatedAt: FieldValue.serverTimestamp(),
      });
      out[side] = { season: season.id, before, after, verdict: verdict.sides[side]!, flags: verdict.flags, reward: 'reward' in change ? change.reward : undefined };
    });
    const counted = input.match.winner !== null;
    if (counted) tx.set(pairRef, { day: today, count: pairCount + 1 });
    if (verdict.flags.length > 0) {
      tx.create(db.collection(RANKED_FLAGS).doc(), {
        at: FieldValue.serverTimestamp(),
        season: season.id,
        room: input.room,
        flags: verdict.flags,
        winner: input.match.winner,
        ended: input.match.ended,
        durationMs: input.match.durationMs,
        budget: input.match.budget,
        pairCount,
        players: Object.fromEntries(sides.map((s) => [s, { ...input.match.sides[s], name: input.names[s] ?? '?' }])),
        reviewed: false,
      });
    }
    return { sides: out, pairCount: counted ? pairCount + 1 : pairCount };
  });
}

/** Top of a season's leaderboard, plus the viewer's own row and position. */
export async function leaderboard(season: string, uid: string | null, limit = 50): Promise<{ rows: StandingRow[]; me: StandingRow | null }> {
  const col = standings(season);
  const row = (d: DocumentSnapshot, position: number): StandingRow => ({
    position,
    self: d.id === uid,
    name: String(d.get('name') ?? '?'),
    tier: d.get('tier'),
    cls: Number(d.get('cls') ?? 1),
    diamonds: Number(d.get('diamonds') ?? 0),
    points: Number(d.get('points') ?? 0),
    wins: Number(d.get('wins') ?? 0),
    losses: Number(d.get('losses') ?? 0),
  });
  const top = await col.orderBy('score', 'desc').limit(limit).get();
  const rows = top.docs.map((d, i) => row(d, i + 1));
  let me = rows.find((r) => r.self) ?? null;
  if (!me && uid) {
    const snap = await col.doc(uid).get();
    if (snap.exists) {
      const higher = await col.where('score', '>', snap.get('score')).count().get();
      me = row(snap, higher.data().count + 1);
    }
  }
  return { rows, me };
}

/** Newest flags first (filtered in memory: no composite index needed at admin scale). */
export async function listFlags(reviewed: boolean, limit = 200): Promise<RankFlagDoc[]> {
  const snap = await firestore().collection(RANKED_FLAGS).orderBy('at', 'desc').limit(limit).get();
  return snap.docs
    .map((d) => {
      const { at, ...data } = d.data();
      return { ...(data as Omit<RankFlagDoc, 'id' | 'at'>), id: d.id, at: at instanceof Timestamp ? at.toMillis() : null };
    })
    .filter((f) => Boolean(f.reviewed) === reviewed);
}

export async function reviewFlag(id: string, by: string): Promise<void> {
  await firestore().collection(RANKED_FLAGS).doc(id).update({ reviewed: true, reviewedBy: by, reviewedAt: FieldValue.serverTimestamp() });
}

/** Lifts a dispute lock: the player's disputes this season go back to 0. */
export async function clearDisputes(uid: string): Promise<void> {
  const ref = players().doc(uid);
  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const player = parse(snap.data());
    if (!player.ranked) return;
    writeChange(tx, ref, snap, { state: { ...player, ranked: { ...player.ranked, disputes: 0 } } });
  });
}
