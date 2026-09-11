import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLECTIONS, COLLECTION_SCHEMAS, settingsSchema } from '@/shared/schema';
import { SEED } from '@/shared/seed';
import { findRefIssues } from '@/shared/validate';
import { generateBotArmy } from '../bot/generate';
import { armyCost, validateArmy, type Armies } from './army';
import { Terrain } from './terrain';
import { BattleSim } from './world';

test('seed content passes schemas and reference checks', () => {
  for (const c of COLLECTIONS) {
    for (const doc of SEED[c]) {
      const r = COLLECTION_SCHEMAS[c].safeParse(doc);
      assert.ok(r.success, `${c}/${doc.id}: ${r.success ? '' : JSON.stringify(r.error.issues)}`);
    }
  }
  assert.ok(settingsSchema.safeParse(SEED.settings).success);
  assert.deepEqual(findRefIssues(SEED), []);
});

function botArmies(mapId: string, seed: number): { terrain: Terrain; armies: Armies; budget: number } {
  const map = SEED.maps.find((m) => m.id === mapId)!;
  const terrain = new Terrain(map, SEED.assets);
  const bot = SEED.bots.find((b) => b.id === 'chien-binh')!;
  const budget = map.budget;
  const blue = generateBotArmy({ bot, content: SEED, terrain, side: 'blue', budget, seed });
  const red = generateBotArmy({ bot: SEED.bots.find((b) => b.id === 'tuong-quan')!, content: SEED, terrain, side: 'red', budget, enemy: blue, seed: seed + 1 });
  return { terrain, armies: { blue, red }, budget };
}

test('every bot builds a legal army on every map', () => {
  for (const map of SEED.maps) {
    const terrain = new Terrain(map, SEED.assets);
    for (const bot of SEED.bots) {
      for (const side of ['blue', 'red'] as const) {
        const army = generateBotArmy({ bot, content: SEED, terrain, side, budget: map.budget, seed: 42 });
        assert.ok(army.length > 0, `${bot.id} on ${map.id} produced nothing`);
        const check = validateArmy(SEED, terrain, side, army, map.budget);
        assert.ok(check.ok, `${bot.id}/${map.id}/${side}: ${check.ok ? '' : check.error} cost=${armyCost(SEED, army)}`);
      }
    }
  }
});

test('battle is deterministic and finishes', () => {
  const run = () => {
    const { terrain, armies } = botArmies('song-xanh', 7);
    const sim = new BattleSim(SEED, terrain.map, terrain, armies, 12345);
    const sums: number[] = [];
    while (!sim.result && sim.tick < 30 * 300) {
      sim.step();
      if (sim.tick % 30 === 0) sums.push(sim.checksum());
    }
    return { sums, result: sim.result };
  };
  const a = run();
  const b = run();
  assert.ok(a.result, 'battle must end');
  assert.deepEqual(a.sums, b.sums);
  assert.deepEqual(a.result, b.result);
});

test('different seeds diverge', () => {
  const { terrain, armies } = botArmies('dong-co', 3);
  const s1 = new BattleSim(SEED, terrain.map, terrain, armies, 1);
  const s2 = new BattleSim(SEED, terrain.map, terrain, armies, 2);
  for (let i = 0; i < 30 * 20; i++) {
    s1.step();
    s2.step();
  }
  assert.notEqual(s1.checksum(), s2.checksum());
});
