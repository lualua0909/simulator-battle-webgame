import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyPlayer, type PlayerState, type RankState } from './economy';
import {
  claimSeasonReward,
  currentSeason,
  freshRank,
  judgeRanked,
  pendingSeasonReward,
  pickPairs,
  rankedGate,
  rankScore,
  rankSteps,
  settleRankedPlayer,
  stepRank,
  type QueueEntry,
  type RankedMatch,
} from './ranked';
import { rankedSchema } from './schema';
import { SEED } from './seed';

const DAY = 86_400_000;
const cfg = rankedSchema.parse({ seasonStart: '2026-09-01', seasonDays: 30 });
/** 2026-09-01 00:00 in Vietnam. */
const S1 = Date.UTC(2026, 7, 31, 17);
const season1 = currentSeason(cfg, S1 + DAY)!;
const season2 = currentSeason(cfg, S1 + 31 * DAY)!;
const random = () => 0.5;
const at = (s: Partial<RankState>): RankState => ({ ...freshRank('s1'), ...s });
const wins = (s: RankState, n: number) => Array.from({ length: n }).reduce<RankState>((x) => stepRank(x, 'win', cfg), s);

test('seasons run back to back from seasonStart in Vietnam time', () => {
  assert.equal(currentSeason(cfg, S1 - 1), null);
  assert.deepEqual(currentSeason(cfg, S1), { id: 's1', number: 1, name: 'Mùa 1', startsAt: S1, endsAt: S1 + 30 * DAY });
  assert.equal(currentSeason(cfg, S1 + 30 * DAY - 1)!.id, 's1');
  assert.equal(season2.id, 's2');
  assert.equal(currentSeason({ ...cfg, enabled: false }, S1 + DAY), null);
});

test('wins fill diamonds, then classes, then tiers up to master', () => {
  const b = cfg.tiers.beginner;
  assert.deepEqual(wins(freshRank('s1'), b.diamonds), at({ diamonds: b.diamonds }));
  assert.deepEqual(wins(freshRank('s1'), b.diamonds + 1), at({ cls: 2 }));
  assert.deepEqual(wins(freshRank('s1'), b.classes * (b.diamonds + 1)), at({ tier: 'great' }));
  const topUltra = at({ tier: 'ultra', cls: cfg.tiers.ultra.classes, diamonds: cfg.tiers.ultra.diamonds });
  assert.deepEqual(stepRank(topUltra, 'win', cfg), at({ tier: 'master' }));
  assert.equal(stepRank(at({ tier: 'master', points: 99_990 }), 'win', cfg).points, 99_999);
});

test('losses take diamonds back down, across classes and tiers (beginner never loses)', () => {
  assert.deepEqual(stepRank(at({ cls: 2 }), 'lose', cfg), at({ cls: 2 }));
  const great = cfg.tiers.great;
  assert.deepEqual(stepRank(at({ tier: 'great', cls: 2, diamonds: 1 }), 'lose', cfg), at({ tier: 'great', cls: 2 }));
  assert.deepEqual(stepRank(at({ tier: 'great', cls: 2 }), 'lose', cfg), at({ tier: 'great', cls: 1, diamonds: great.diamonds }));
  assert.deepEqual(stepRank(at({ tier: 'great' }), 'lose', cfg), at({ tier: 'beginner', cls: cfg.tiers.beginner.classes, diamonds: cfg.tiers.beginner.diamonds }));
  assert.equal(stepRank(at({ tier: 'master', points: 30 }), 'lose', cfg).points, 10);
  assert.deepEqual(stepRank(at({ tier: 'master' }), 'lose', cfg), at({ tier: 'ultra', cls: cfg.tiers.ultra.classes, diamonds: cfg.tiers.ultra.diamonds }));
});

test('a win then a loss always lands back where it started (above beginner)', () => {
  for (const tier of ['great', 'expert', 'veteran', 'ultra'] as const) {
    for (let cls = 1; cls <= cfg.tiers[tier].classes; cls++) {
      for (let diamonds = 0; diamonds <= cfg.tiers[tier].diamonds; diamonds++) {
        const s = at({ tier, cls, diamonds });
        assert.deepEqual(stepRank(stepRank(s, 'win', cfg), 'lose', cfg), s, `${tier} ${cls} ${diamonds}`);
      }
    }
  }
});

test('steps and scores grow by one per win and sort tiers first', () => {
  let s = freshRank('s1');
  for (let i = 1; i < 60; i++) {
    const next = stepRank(s, 'win', cfg);
    assert.equal(rankSteps(next, cfg), rankSteps(s, cfg) + 1);
    assert.ok(rankScore(next, cfg) > rankScore(s, cfg));
    s = next;
  }
  assert.ok(rankScore(at({ tier: 'master' }), cfg) > rankScore(at({ tier: 'ultra', cls: 5, diamonds: 5 }), cfg));
});

test('a new season pays the tier the last one ended in and restarts one tier lower', () => {
  const veteran: PlayerState = { ...emptyPlayer(), ranked: at({ tier: 'veteran', cls: 4, wins: 30, losses: 12 }) };
  assert.equal(pendingSeasonReward(veteran, season1, cfg), null);
  assert.deepEqual(pendingSeasonReward(veteran, season2, cfg), { season: 's1', tier: 'veteran' });
  const claimed = claimSeasonReward(veteran, season2, cfg, SEED.units, random);
  assert.ok('entry' in claimed && claimed.entry.type === 'rank-season');
  const box = cfg.tiers.veteran.seasonBox;
  assert.ok(claimed.state.coins >= box.coins[0] && claimed.state.coins <= box.coins[1]);
  assert.deepEqual(claimed.state.ranked, freshRank('s2', 'expert'));
  assert.throws(() => claimSeasonReward(claimed.state, season2, cfg, SEED.units, random), /Không có thưởng/);
  // A standing carried into a season without playing it earns nothing at the end of that season.
  const season3 = currentSeason(cfg, S1 + 61 * DAY)!;
  assert.equal(pendingSeasonReward(claimed.state, season3, cfg), null);
  assert.ok(!('entry' in claimSeasonReward(claimed.state, season3, cfg, SEED.units, random)));
});

test('ranked needs an old enough account with enough bot wins, no unclaimed season box and few disputes', () => {
  const now = S1 + 10 * DAY;
  const veteranUser = { ...emptyPlayer(), botWinTotal: cfg.minBotWins };
  const gate = (createdAt: number | null, player: PlayerState) => rankedGate({ createdAt, player, season: currentSeason(cfg, now), cfg, now });
  assert.equal(gate(now - 10 * DAY, veteranUser), null);
  assert.match(gate(now - DAY, veteranUser)!, /ngày tuổi/);
  assert.match(gate(now - 10 * DAY, { ...veteranUser, botWinTotal: cfg.minBotWins - 1 })!, /Thắng bot/);
  assert.match(gate(now - 10 * DAY, { ...veteranUser, ranked: at({ disputes: cfg.maxDisputes }) })!, /tranh chấp/);
  const lastSeason = { ...veteranUser, ranked: { ...at({ wins: 1 }), season: 's0' } };
  assert.match(gate(now - 10 * DAY, lastSeason)!, /thưởng mùa/);
  assert.match(rankedGate({ createdAt: null, player: veteranUser, season: null, cfg, now })!, /tạm đóng/);
});

test('matchmaking pairs the closest ranks within a gap that widens with waiting, never the same IP', () => {
  const q = (uid: string, steps: number, since = 0, ip: string | null = uid): QueueEntry => ({ uid, ip, steps, since });
  const none = () => false;
  const ids = (pairs: Array<[QueueEntry, QueueEntry]>) => pairs.map(([a, b]) => [a.uid, b.uid].sort().join('+'));
  assert.deepEqual(ids(pickPairs([q('a', 10), q('b', 30), q('c', 12)], 0, cfg, none)), ['a+c']);
  assert.deepEqual(ids(pickPairs([q('a', 0), q('b', 20)], 0, cfg, none)), []);
  // 20 steps apart: allowed after (20 - matchGap) / matchGapGrowth × 10 s of waiting.
  const wait = Math.ceil((20 - cfg.matchGap) / cfg.matchGapGrowth) * 10_000;
  assert.deepEqual(ids(pickPairs([q('a', 0), q('b', 20)], wait, cfg, none)), ['a+b']);
  assert.deepEqual(ids(pickPairs([q('a', 5, 0, '1.2.3.4'), q('b', 5, 0, '1.2.3.4')], 0, cfg, none)), []);
  assert.deepEqual(ids(pickPairs([q('a', 5, 0, '1.2.3.4'), q('b', 5, 0, '1.2.3.4')], 0, { ...cfg, blockSameIp: false }, none)), ['a+b']);
  assert.deepEqual(ids(pickPairs([q('a', 5), q('b', 5), q('c', 6)], 0, cfg, (x, y) => [x, y].sort().join() === 'a,b')), ['a+c']);
});

test('ranked verdicts: counted wins, draws, and the anti win-trading exceptions', () => {
  const match = (m: Partial<RankedMatch>): RankedMatch => ({
    winner: 'blue',
    ended: 'report',
    durationMs: 120_000,
    budget: 3000,
    sides: { blue: { uid: 'a', ip: '1.1.1.1', armyCost: 3000 }, red: { uid: 'b', ip: '2.2.2.2', armyCost: 2900 } },
    pairCount: 0,
    ...m,
  });
  const win = { outcome: 'win', move: true };
  const lose = { outcome: 'lose', move: true };
  assert.deepEqual(judgeRanked(match({}), cfg), { flags: [], sides: { blue: win, red: lose } });
  assert.deepEqual(judgeRanked(match({ winner: 'draw' }), cfg).sides.blue, { outcome: 'draw', move: false });
  assert.deepEqual(judgeRanked(match({ winner: null }), cfg), { flags: ['dispute'], sides: { blue: { outcome: 'void', move: false }, red: { outcome: 'void', move: false } } });
  // Same two accounts past the daily limit: recorded, nobody moves.
  assert.deepEqual(judgeRanked(match({ pairCount: cfg.pairDailyLimit }), cfg), { flags: ['repeat-pair'], sides: { blue: { outcome: 'win', move: false }, red: { outcome: 'lose', move: false } } });
  // Thrown games: the loser still loses, the winner gains nothing.
  const early = judgeRanked(match({ ended: 'forfeit', durationMs: 5000 }), cfg);
  assert.deepEqual(early, { flags: ['early-end'], sides: { blue: { outcome: 'win', move: false }, red: lose } });
  assert.deepEqual(judgeRanked(match({ durationMs: 5000 }), cfg).flags, [], 'a fast win both simulations reported is not a forfeit');
  const token = judgeRanked(match({ sides: { blue: { uid: 'a', ip: null, armyCost: 3000 }, red: { uid: 'b', ip: null, armyCost: 100 } } }), cfg);
  assert.deepEqual(token, { flags: ['weak-army'], sides: { blue: { outcome: 'win', move: false }, red: lose } });
  assert.deepEqual(judgeRanked(match({ sides: { blue: { uid: 'a', ip: '9.9.9.9', armyCost: 3000 }, red: { uid: 'b', ip: '9.9.9.9', armyCost: 3000 } } }), cfg).flags, ['same-ip']);
});

test('a counted ranked win pays a box until the daily cap; losses and disputes only move the standing', () => {
  const now = S1 + DAY;
  const capped = { ...cfg, winRewardDailyCap: 1 };
  const first = settleRankedPlayer(emptyPlayer(), season1, { outcome: 'win', move: true }, capped, SEED.units, now, random);
  assert.ok('entry' in first && first.entry.type === 'rank-win');
  assert.deepEqual(first.state.ranked, { ...freshRank('s1'), diamonds: 1, wins: 1, rewardDay: '2026-09-02', rewardsToday: 1 });
  const second = settleRankedPlayer(first.state, season1, { outcome: 'win', move: true }, capped, SEED.units, now, random);
  assert.ok(!('entry' in second));
  assert.equal(second.state.ranked!.diamonds, 2);
  const hollow = settleRankedPlayer(emptyPlayer(), season1, { outcome: 'win', move: false }, cfg, SEED.units, now, random);
  assert.ok(!('entry' in hollow));
  assert.deepEqual(hollow.state.ranked, { ...freshRank('s1'), wins: 1 });
  const disputed = settleRankedPlayer(emptyPlayer(), season1, { outcome: 'void', move: false }, cfg, SEED.units, now, random);
  assert.equal(disputed.state.ranked!.disputes, 1);
});
