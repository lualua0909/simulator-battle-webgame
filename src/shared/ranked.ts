// Ranked mode rules (Pokemon Unite style): tiers → classes → diamonds, master points, seasons,
// matchmaking and the anti win-trading checks. Pure: the server applies them inside Firestore
// transactions (src/server/ranked.ts), the browser uses them for display, the tests run them.
//
// The server never simulates a battle, so it cannot tell a real win from one an accomplice threw.
// Instead win-trading is made unprofitable: ranked is matchmaking only (no picking the opponent),
// new/unplayed accounts cannot queue, the same two accounts only count `pairDailyLimit` times a
// day, early forfeits and token armies give the winner nothing, and win boxes are capped per day.
import type { Side } from '@/game/sim/terrain';
import { EconomyError, rollBox, vnDay, type BoxReward, type Change, type LedgerEntry, type PlayerState, type Quiet, type Random, type RankState } from './economy';
import { RANK_TIERS, type RankedSettings, type RankTier, type UnitDef } from './schema';

const DAY_MS = 86_400_000;
/** Seasons follow Vietnam dates (UTC+7, no daylight saving). */
const VN_OFFSET_MS = 7 * 3_600_000;
/** Highest master score shown (0 – 99999). */
export const MASTER_MAX = 99_999;
export const RANKED_STANDINGS = 'ranked_seasons';
export const RANKED_FLAGS = 'ranked_flags';
export const RANKED_PAIRS = 'ranked_pairs';

// ---------------------------------------------------------------- seasons

export interface Season {
  /** 's1', 's2', … */
  id: string;
  number: number;
  name: string;
  startsAt: number;
  endsAt: number;
}

export function seasonName(id: string): string {
  return `Season ${id.replace(/^s/, '')}`;
}

/** The season running at `now`: back-to-back `seasonDays` periods from `seasonStart`. Null while ranked is off or before season 1. */
export function currentSeason(cfg: Pick<RankedSettings, 'enabled' | 'seasonStart' | 'seasonDays'>, now: number): Season | null {
  if (!cfg.enabled) return null;
  const start = Date.parse(`${cfg.seasonStart}T00:00:00Z`) - VN_OFFSET_MS;
  if (!Number.isFinite(start) || now < start) return null;
  const length = cfg.seasonDays * DAY_MS;
  const i = Math.floor((now - start) / length);
  const id = `s${i + 1}`;
  return { id, number: i + 1, name: seasonName(id), startsAt: start + i * length, endsAt: start + (i + 1) * length };
}

export function freshRank(season: string, tier: RankTier = 'beginner'): RankState {
  return { season, tier, cls: 1, diamonds: 0, points: 0, wins: 0, losses: 0, draws: 0, disputes: 0, rewardDay: null, rewardsToday: 0 };
}

export function played(s: RankState): number {
  return s.wins + s.losses + s.draws;
}

/**
 * A standing brought into `season`. Same season: unchanged. Older season: that season `ended`, and
 * the new one restarts at class 1, `seasonResetTiers` tiers lower.
 */
export function rollSeason(s: RankState | null, season: string, cfg: Pick<RankedSettings, 'seasonResetTiers'>): { state: RankState; ended: RankState | null } {
  if (!s) return { state: freshRank(season), ended: null };
  if (s.season === season) return { state: s, ended: null };
  return { state: freshRank(season, RANK_TIERS[Math.max(0, RANK_TIERS.indexOf(s.tier) - cfg.seasonResetTiers)]), ended: s };
}

export interface SeasonReward {
  season: string;
  tier: RankTier;
}

/** The reward waiting for the last season the player fought in (null when there is none). */
export function pendingSeasonReward(p: Pick<PlayerState, 'ranked'>, season: Season | null, cfg: RankedSettings): SeasonReward | null {
  if (!season) return null;
  const { ended } = rollSeason(p.ranked, season.id, cfg);
  return ended && played(ended) > 0 ? { season: ended.season, tier: ended.tier } : null;
}

function addCards(p: PlayerState, reward: BoxReward): Record<string, number> {
  const cards = { ...p.cards };
  for (const c of reward.cards) cards[c.unitId] = (cards[c.unitId] ?? 0) + c.count;
  return cards;
}

const rewardCards = (reward: BoxReward) => Object.fromEntries(reward.cards.map((c) => [c.unitId, c.count]));

/** Pays the box of the tier the last season ended in and moves the standing into the current season. */
export function claimSeasonReward(p: PlayerState, season: Season | null, cfg: RankedSettings, units: readonly UnitDef[], random: Random): Change | Quiet {
  if (!season) throw new EconomyError('Chế độ xếp hạng đang tạm đóng');
  const { state, ended } = rollSeason(p.ranked, season.id, cfg);
  if (!ended) throw new EconomyError('Không có thưởng mùa nào để nhận');
  if (played(ended) === 0) return { state: { ...p, ranked: state } };
  const reward = rollBox(units, cfg.tiers[ended.tier].seasonBox, random);
  const next: PlayerState = { ...p, coins: p.coins + reward.coins, cards: addCards(p, reward), ranked: state };
  const entry: LedgerEntry = { type: 'rank-season', coins: reward.coins, balance: next.coins, cards: rewardCards(reward), note: `Thưởng ${seasonName(ended.season)}: ${rankLabel(ended, cfg)}` };
  return { state: next, entry, reward };
}

/** The ranked lobby's data (GET /api/ranked). */
export interface RankView {
  season: Season | null;
  /** Standing carried into the running season (null: never played and no season running). */
  rank: RankState | null;
  pending: SeasonReward | null;
  /** Why the player may not queue right now (null = may queue). */
  gate: string | null;
  botWins: number;
  /** Server clock (ms), for the season countdown. */
  now: number;
}

/** One leaderboard line. */
export interface StandingRow {
  position: number;
  self: boolean;
  name: string;
  tier: RankTier;
  cls: number;
  diamonds: number;
  points: number;
  wins: number;
  losses: number;
}

// ---------------------------------------------------------------- tiers

/** Clamps a stored standing to the current CMS tier sizes (classes/diamonds may have shrunk). */
function normalize(s: RankState, cfg: Pick<RankedSettings, 'tiers'>): RankState {
  if (s.tier === 'master') return { ...s, cls: 1, diamonds: 0 };
  const t = cfg.tiers[s.tier];
  return { ...s, cls: Math.min(s.cls, t.classes), diamonds: Math.min(s.diamonds, t.diamonds) };
}

/**
 * One diamond up or down. A win on a full class moves to the next class (next tier after the
 * last class, master after ultra) with no diamonds; a loss on an empty class moves back to the
 * class below with it full, so a win and a loss always cancel out. Tiers with `loseDiamond` off
 * never lose; master trades points and drops to the top of ultra from 0.
 */
export function stepRank(from: RankState, result: 'win' | 'lose', cfg: Pick<RankedSettings, 'tiers' | 'masterWin' | 'masterLoss'>): RankState {
  const s = normalize(from, cfg);
  const i = RANK_TIERS.indexOf(s.tier);
  const t = cfg.tiers[s.tier];
  if (result === 'win') {
    if (s.tier === 'master') return { ...s, points: Math.min(MASTER_MAX, s.points + cfg.masterWin) };
    if (s.diamonds < t.diamonds) return { ...s, diamonds: s.diamonds + 1 };
    if (s.cls < t.classes) return { ...s, cls: s.cls + 1, diamonds: 0 };
    return { ...s, tier: RANK_TIERS[i + 1], cls: 1, diamonds: 0, points: 0 };
  }
  if (!t.loseDiamond) return s;
  if (s.tier === 'master' && s.points > 0) return { ...s, points: Math.max(0, s.points - cfg.masterLoss) };
  if (s.tier !== 'master' && s.diamonds > 0) return { ...s, diamonds: s.diamonds - 1 };
  if (s.tier !== 'master' && s.cls > 1) return { ...s, cls: s.cls - 1, diamonds: t.diamonds };
  if (i === 0) return s;
  const below = RANK_TIERS[i - 1];
  return { ...s, tier: below, cls: cfg.tiers[below].classes, diamonds: cfg.tiers[below].diamonds, points: 0 };
}

/** Diamond steps from the bottom (matchmaking distance): one win = one step; master adds a step per `masterWin` points. */
export function rankSteps(from: RankState, cfg: Pick<RankedSettings, 'tiers' | 'masterWin'>): number {
  const s = normalize(from, cfg);
  let steps = 0;
  for (const tier of RANK_TIERS) {
    if (tier === s.tier) break;
    steps += cfg.tiers[tier].classes * (cfg.tiers[tier].diamonds + 1);
  }
  if (s.tier === 'master') return steps + Math.floor(s.points / Math.max(1, cfg.masterWin));
  return steps + (s.cls - 1) * (cfg.tiers[s.tier].diamonds + 1) + s.diamonds;
}

/** Leaderboard sort key: tier first, then class and diamonds (or master points). */
export function rankScore(from: RankState, cfg: Pick<RankedSettings, 'tiers'>): number {
  const s = normalize(from, cfg);
  const within = s.tier === 'master' ? s.points : (s.cls - 1) * (cfg.tiers[s.tier].diamonds + 1) + s.diamonds;
  return RANK_TIERS.indexOf(s.tier) * 1_000_000 + within;
}

export function rankLabel(s: Pick<RankState, 'tier' | 'cls' | 'points'>, cfg: Pick<RankedSettings, 'tiers'>): string {
  const name = cfg.tiers[s.tier].name;
  return s.tier === 'master' ? `${name} · ${s.points} pts` : `${name} · Class ${s.cls}`;
}

// ---------------------------------------------------------------- queue

/** Why this player may not queue for ranked right now, or null when they may. */
export function rankedGate(input: { createdAt: number | null; player: PlayerState; season: Season | null; cfg: RankedSettings; now: number }): string | null {
  const { createdAt, player, season, cfg, now } = input;
  if (!season) return 'Chế độ xếp hạng đang tạm đóng';
  if (createdAt !== null && now - createdAt < cfg.minAccountDays * DAY_MS) {
    const days = Math.ceil((createdAt + cfg.minAccountDays * DAY_MS - now) / DAY_MS);
    return `Tài khoản cần ít nhất ${cfg.minAccountDays} ngày tuổi để đánh xếp hạng (còn ${days} ngày)`;
  }
  if (player.botWinTotal < cfg.minBotWins) return `Thắng bot và nhận thưởng ${cfg.minBotWins} lần để mở khóa xếp hạng (bạn đã có ${player.botWinTotal})`;
  if (pendingSeasonReward(player, season, cfg)) return 'Hãy nhận thưởng mùa trước đã';
  if (rollSeason(player.ranked, season.id, cfg).state.disputes >= cfg.maxDisputes) return 'Xếp hạng tạm khóa vì quá nhiều trận có kết quả tranh chấp — liên hệ quản trị viên';
  return null;
}

export interface QueueEntry {
  uid: string;
  ip: string | null;
  /** `rankSteps` of the player's standing. */
  steps: number;
  /** Epoch ms the player joined the queue. */
  since: number;
}

/**
 * Pairs to start now: longest waiter first, each with the closest-ranked partner within the
 * allowed gap (`matchGap`, widened by `matchGapGrowth` per 10 s the older of the two has waited).
 * `blocked` rules out pairs that already played their `pairDailyLimit` today.
 */
export function pickPairs(queue: readonly QueueEntry[], now: number, cfg: Pick<RankedSettings, 'matchGap' | 'matchGapGrowth' | 'blockSameIp'>, blocked: (a: string, b: string) => boolean): Array<[QueueEntry, QueueEntry]> {
  const waiting = [...queue].sort((a, b) => a.since - b.since);
  const used = new Set<string>();
  const pairs: Array<[QueueEntry, QueueEntry]> = [];
  for (const a of waiting) {
    if (used.has(a.uid)) continue;
    let best: QueueEntry | null = null;
    for (const b of waiting) {
      if (b.uid === a.uid || used.has(b.uid)) continue;
      if (cfg.blockSameIp && a.ip && a.ip === b.ip) continue;
      if (blocked(a.uid, b.uid)) continue;
      const gap = Math.abs(a.steps - b.steps);
      const allowed = cfg.matchGap + cfg.matchGapGrowth * Math.floor((now - Math.min(a.since, b.since)) / 10_000);
      if (gap <= allowed && (!best || gap < Math.abs(a.steps - best.steps))) best = b;
    }
    if (best) {
      used.add(a.uid);
      used.add(best.uid);
      pairs.push([a, best]);
    }
  }
  return pairs;
}

/** Firestore id of a pair of accounts (order-independent). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

// ---------------------------------------------------------------- results

export const RANK_FLAGS = ['dispute', 'repeat-pair', 'early-end', 'weak-army', 'same-ip'] as const;
export type RankFlag = (typeof RANK_FLAGS)[number];

export const RANK_FLAG_LABELS: Record<RankFlag, string> = {
  dispute: 'Kết quả tranh chấp (báo cáo lệch / desync)',
  'repeat-pair': 'Cặp đấu lặp lại quá giới hạn ngày',
  'early-end': 'Đầu hàng / thoát quá sớm',
  'weak-army': 'Đội thua quá rẻ so với ngân sách',
  'same-ip': 'Cùng địa chỉ IP',
};

export interface RankedMatch {
  /** Winning side, 'draw', or null when the result was voided (reports disagreed, desync). */
  winner: Side | 'draw' | null;
  /** 'report': both simulations reported the end; 'forfeit': a surrender or disconnect ended it on the server. */
  ended: 'report' | 'forfeit';
  /** Wall-clock time from battle start to the end. */
  durationMs: number;
  budget: number;
  sides: Partial<Record<Side, { uid: string; ip: string | null; armyCost: number }>>;
  /** Ranked battles these two accounts already played today, before this one. */
  pairCount: number;
}

export interface SideVerdict {
  outcome: 'win' | 'lose' | 'draw' | 'void';
  /** Diamonds/points move (false: counted in the record only). */
  move: boolean;
}

export interface RankVerdict {
  flags: RankFlag[];
  sides: Partial<Record<Side, SideVerdict>>;
}

/** What a finished ranked battle does to each side, and why it looks suspicious (flags for the admins). */
export function judgeRanked(m: RankedMatch, cfg: Pick<RankedSettings, 'pairDailyLimit' | 'minBattleSeconds' | 'minArmyShare'>): RankVerdict {
  const sides = Object.keys(m.sides) as Side[];
  const each = (v: (s: Side) => SideVerdict) => Object.fromEntries(sides.map((s) => [s, v(s)])) as Partial<Record<Side, SideVerdict>>;
  if (m.winner === null) return { flags: ['dispute'], sides: each(() => ({ outcome: 'void', move: false })) };
  const flags: RankFlag[] = [];
  const ips = sides.map((s) => m.sides[s]!.ip);
  if (ips.length === 2 && ips[0] !== null && ips[0] === ips[1]) flags.push('same-ip');
  const repeat = m.pairCount >= cfg.pairDailyLimit;
  if (repeat) flags.push('repeat-pair');
  if (m.winner === 'draw') return { flags, sides: each(() => ({ outcome: 'draw', move: false })) };
  const winner = m.winner;
  if (m.ended === 'forfeit' && m.durationMs < cfg.minBattleSeconds * 1000) flags.push('early-end');
  if (sides.some((s) => s !== winner && m.sides[s]!.armyCost < cfg.minArmyShare * m.budget)) flags.push('weak-army');
  const hollow = flags.includes('early-end') || flags.includes('weak-army');
  return { flags, sides: each((s) => (s === winner ? { outcome: 'win', move: !repeat && !hollow } : { outcome: 'lose', move: !repeat })) };
}

/** What one player sees after a ranked battle. */
export interface RankResult {
  season: string;
  before: RankState;
  after: RankState;
  verdict: SideVerdict;
  flags: RankFlag[];
  reward?: BoxReward;
}

/** A flagged ranked battle, as the admin page lists it (`ranked_flags`). */
export interface RankFlagDoc {
  id: string;
  at: number | null;
  season: string;
  room: string;
  flags: RankFlag[];
  winner: Side | 'draw' | null;
  ended: RankedMatch['ended'];
  durationMs: number;
  budget: number;
  pairCount: number;
  players: Partial<Record<Side, { uid: string; name: string; ip: string | null; armyCost: number }>>;
  reviewed: boolean;
  reviewedBy?: string;
}

/** A side's verdict applied to its standing (record, diamonds, disputes). */
export function applyVerdict(s: RankState, v: SideVerdict, cfg: RankedSettings): RankState {
  if (v.outcome === 'void') return { ...s, disputes: s.disputes + 1 };
  const counted: RankState = { ...s, wins: s.wins + (v.outcome === 'win' ? 1 : 0), losses: s.losses + (v.outcome === 'lose' ? 1 : 0), draws: s.draws + (v.outcome === 'draw' ? 1 : 0) };
  return v.move && v.outcome !== 'draw' ? stepRank(counted, v.outcome, cfg) : counted;
}

/** One player's wallet after a ranked battle: new standing, plus a win box for a counted win (daily cap). */
export function settleRankedPlayer(p: PlayerState, season: Season, v: SideVerdict, cfg: RankedSettings, units: readonly UnitDef[], now: number, random: Random): Change | Quiet {
  const ranked = applyVerdict(rollSeason(p.ranked, season.id, cfg).state, v, cfg);
  const today = vnDay(now);
  const boxes = ranked.rewardDay === today ? ranked.rewardsToday : 0;
  if (v.outcome !== 'win' || !v.move || (cfg.winRewardDailyCap > 0 && boxes >= cfg.winRewardDailyCap)) return { state: { ...p, ranked } };
  const reward = rollBox(units, cfg.winBox, random);
  const next: PlayerState = { ...p, coins: p.coins + reward.coins, cards: addCards(p, reward), ranked: { ...ranked, rewardDay: today, rewardsToday: boxes + 1 } };
  const entry: LedgerEntry = { type: 'rank-win', coins: reward.coins, balance: next.coins, cards: rewardCards(reward), note: `Thắng xếp hạng ${seasonName(season.id)}` };
  return { state: next, entry, reward };
}
