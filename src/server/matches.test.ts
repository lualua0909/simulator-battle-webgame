import assert from 'node:assert/strict';
import test from 'node:test';
import type { Side } from '@/game/sim/terrain';
import type { BattleOutcome } from '@/shared/net';
import { judgeMatch } from './matches';

const battle = (blue: BattleOutcome, red: BattleOutcome, opts: { redTick?: number; desync?: boolean; verified?: number[] } = {}) => ({
  activeSides: ['blue', 'red'] satisfies Side[] as Side[],
  reports: { blue: { outcome: blue, tick: 90 }, red: { outcome: red, tick: opts.redTick ?? 90 } },
  verified: new Set(opts.verified ?? [30, 60, 90]),
  desync: opts.desync ?? false,
});

test('win/lose, lose/win and draw/draw are accepted', () => {
  assert.deepEqual(judgeMatch(battle('win', 'lose')), { ok: true, winner: 'blue', tick: 90 });
  assert.deepEqual(judgeMatch(battle('lose', 'win')), { ok: true, winner: 'red', tick: 90 });
  assert.deepEqual(judgeMatch(battle('draw', 'draw')), { ok: true, winner: 'draw', tick: 90 });
});

test('contradictory outcomes are voided', () => {
  for (const [blue, red] of [
    ['win', 'win'],
    ['lose', 'lose'],
    ['draw', 'win'],
    ['lose', 'draw'],
  ] as const) {
    assert.equal(judgeMatch(battle(blue, red)).ok, false, `${blue}/${red}`);
  }
});

test('a missing report, different end ticks, a desync or a missing checksum void the result', () => {
  assert.equal(judgeMatch({ ...battle('win', 'lose'), reports: { blue: { outcome: 'win', tick: 90 } } }).ok, false);
  assert.equal(judgeMatch(battle('win', 'lose', { redTick: 120 })).ok, false);
  assert.equal(judgeMatch(battle('win', 'lose', { desync: true })).ok, false);
  assert.equal(judgeMatch(battle('win', 'lose', { verified: [30, 90] })).ok, false);
});

test('3-4 way FFA: exactly one winner with everyone else losing is accepted, and all-draw is a draw', () => {
  assert.deepEqual(
    judgeMatch({
      activeSides: ['blue', 'red', 'green'],
      reports: { blue: { outcome: 'win', tick: 90 }, red: { outcome: 'lose', tick: 90 }, green: { outcome: 'lose', tick: 90 } },
      verified: new Set([30, 60, 90]),
      desync: false,
    }),
    { ok: true, winner: 'blue', tick: 90 },
  );
  assert.deepEqual(
    judgeMatch({
      activeSides: ['blue', 'red', 'green', 'yellow'],
      reports: { blue: { outcome: 'draw', tick: 90 }, red: { outcome: 'draw', tick: 90 }, green: { outcome: 'draw', tick: 90 }, yellow: { outcome: 'draw', tick: 90 } },
      verified: new Set([30, 60, 90]),
      desync: false,
    }),
    { ok: true, winner: 'draw', tick: 90 },
  );
});

test('3-4 way FFA: two winners, a stray draw, or a missing report void the result', () => {
  assert.equal(
    judgeMatch({
      activeSides: ['blue', 'red', 'green'],
      reports: { blue: { outcome: 'win', tick: 90 }, red: { outcome: 'win', tick: 90 }, green: { outcome: 'lose', tick: 90 } },
      verified: new Set([30, 60, 90]),
      desync: false,
    }).ok,
    false,
  );
  assert.equal(
    judgeMatch({
      activeSides: ['blue', 'red', 'green'],
      reports: { blue: { outcome: 'win', tick: 90 }, red: { outcome: 'draw', tick: 90 }, green: { outcome: 'lose', tick: 90 } },
      verified: new Set([30, 60, 90]),
      desync: false,
    }).ok,
    false,
  );
  assert.equal(
    judgeMatch({
      activeSides: ['blue', 'red', 'green'],
      reports: { blue: { outcome: 'win', tick: 90 }, red: { outcome: 'lose', tick: 90 } },
      verified: new Set([30, 60, 90]),
      desync: false,
    }).ok,
    false,
  );
});
