import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLECTIONS, COLLECTION_SCHEMAS, settingsSchema, type MapDef, type UnitDef, type WeaponDef } from '@/shared/schema';
import { SEED } from '@/shared/seed';
import { findRefIssues } from '@/shared/validate';
import { generateBotArmy } from '../bot/generate';
import { armies, armyCost, validateArmy, type Armies } from './army';
import { EDGE_MARGIN, Terrain, type Side } from './terrain';
import { BattleSim, type SimEvent } from './world';

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
  const bot = SEED.bots.find((b) => b.id === 'thuong')!;
  const budget = map.budget;
  const blue = generateBotArmy({ bot, content: SEED, terrain, side: 'blue', budget, seed });
  const red = generateBotArmy({ bot: SEED.bots.find((b) => b.id === 'kho')!, content: SEED, terrain, side: 'red', budget, enemy: blue, seed: seed + 1 });
  return { terrain, armies: armies({ blue, red }), budget };
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
    const sim = new BattleSim({ ...SEED, settings: { ...SEED.settings, battleTimeLimit: 240 } }, terrain.map, terrain, armies, 12345);
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

// ------------------------------------------------------------------ skills

const ARENA: MapDef = { ...SEED.maps[0], id: 'arena', size: 80, heightScale: 0, river: { enabled: false, width: 8, meander: 0, ford: 0 }, trees: { perHectare: 0, kinds: [] }, rocks: { perHectare: 0, kinds: [] }, bushes: { perHectare: 0, kinds: [] } };
const NOOP: WeaponDef = { ...SEED.weapons.find((w) => w.id === 'club')!, id: 'noop', damage: 0, range: 0.3, cooldown: 60, knockback: 0 };
const DUMMY: UnitDef = { ...SEED.units.find((u) => u.id === 'clubber')!, id: 'dummy', hp: 5000, speed: 0, weaponId: 'noop', skillIds: [] };

/** One caster (blue) against a tight block of passive dummies (red). */
function skillArena(caster: Partial<UnitDef>, opts: { dummies?: number; gap?: number; seed?: number } = {}) {
  const unit: UnitDef = { ...DUMMY, id: 'caster', hp: 100000, speed: 0, ...caster };
  const content = { ...SEED, units: [...SEED.units, DUMMY, unit], weapons: [...SEED.weapons, NOOP] };
  const terrain = new Terrain(ARENA, []);
  const red = Array.from({ length: opts.dummies ?? 9 }, (_, i) => ({ unitId: 'dummy', x: (opts.gap ?? 10) + (i % 3) * 1.1, z: (Math.floor(i / 3) - 1) * 1.1 }));
  const sim = new BattleSim(content, ARENA, terrain, armies({ blue: [{ unitId: 'caster', x: 0, z: 0 }], red }), opts.seed ?? 99);
  const events: SimEvent[] = [];
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds * 30 && !sim.result; i++) {
      sim.step();
      events.push(...sim.events);
      each?.();
    }
  };
  const hurt = () => sim.units.filter((u) => u.side === 'red' && u.hp < u.def.hp).length;
  return { sim, events, run, hurt };
}

test('sky lightning telegraphs, strikes the group and stuns it', () => {
  const a = skillArena({ weaponId: 'noop', skillIds: ['thien-loi'] });
  let stunned = 0;
  a.run(4, () => (stunned = Math.max(stunned, a.sim.units.filter((u) => u.side === 'red' && u.stun > 0.5).length)));
  const warn = a.events.findIndex((e) => e.type === 'warn');
  const strike = a.events.findIndex((e) => e.type === 'strike');
  assert.ok(warn >= 0 && strike > warn, 'warn must precede strike');
  assert.ok(a.hurt() >= 3, `hurt ${a.hurt()}`);
  assert.ok(stunned >= 2, `stunned ${stunned}`);
});

test('chain lightning jumps between enemies with falloff', () => {
  const a = skillArena({ weaponId: 'noop', skillIds: ['set-chuoi'] });
  a.run(3);
  const chain = a.events.find((e) => e.type === 'chain');
  assert.ok(chain && chain.type === 'chain' && chain.targets.length === 7, `targets ${chain && chain.type === 'chain' ? chain.targets.length : 0}`);
  const hits = a.events.filter((e) => e.type === 'hit' && e.weaponId === 'set-chuoi').map((e) => (e.type === 'hit' ? e.damage : 0));
  assert.ok(hits[0] > hits[hits.length - 1], 'later jumps hit softer');
});

test('whirlwind lifts light units, then collapses', () => {
  const a = skillArena({ weaponId: 'noop', skillIds: ['loc-xoay'] }, { gap: 6 });
  let lifted = 0;
  a.run(12, () => (lifted = Math.max(lifted, a.sim.units.filter((u) => u.side === 'red' && u.airborne).length)));
  assert.ok(a.events.some((e) => e.type === 'zone-end'), 'zone must end');
  assert.equal(a.sim.zones.length, 0);
  assert.ok(lifted >= 3, `lifted ${lifted}`);
  assert.ok(a.hurt() >= 3);
});

test('channelled flame pulses repeatedly and sets targets on fire', () => {
  const a = skillArena({ weaponId: 'noop', skillIds: ['phun-lua'] }, { gap: 4 });
  let burning = 0;
  a.run(5, () => (burning = Math.max(burning, a.sim.units.filter((u) => u.side === 'red' && u.burnLeft > 0).length)));
  const pulses = a.events.filter((e) => e.type === 'attack' && e.weaponId === 'phun-lua').length;
  assert.ok(pulses >= 14, `pulses ${pulses}`);
  assert.ok(burning >= 2, `burning ${burning}`);
});

test('ground slam knocks nearby enemies into the air', () => {
  const a = skillArena({ weaponId: 'noop', skillIds: ['dam-dat'] }, { gap: 1.2 });
  let airborne = 0;
  a.run(4, () => (airborne = Math.max(airborne, a.sim.units.filter((u) => u.side === 'red' && u.airborne).length)));
  assert.ok(a.events.some((e) => e.type === 'nova'));
  assert.ok(airborne >= 3, `airborne ${airborne}`);
});

test('area skills wait for enough targets', () => {
  const a = skillArena({ weaponId: 'noop', skillIds: ['bao-sam'] }, { dummies: 2 });
  a.run(8);
  assert.equal(a.events.filter((e) => e.type === 'warn').length, 0);
});

// ------------------------------------------------------------------ movement

test('a melee unit routes around a blocking tree to reach the enemy', () => {
  const terrain = new Terrain(ARENA, []);
  terrain.obstacles.push({ kind: 'tree', assetId: 'tree', x: 0, y: 0, z: 0, radius: 2, scale: 1, yaw: 0, variant: 0 });
  const sim = new BattleSim(SEED, ARENA, terrain, armies({ blue: [{ unitId: 'clubber', x: -6, z: 0 }], red: [{ unitId: 'clubber', x: 6, z: 0 }] }), 1);
  for (let i = 0; i < 30 * 20 && !sim.result; i++) sim.step();
  assert.ok(sim.result, 'a tree directly on the path between the two units must not deadlock the fight');
});

test('attack speed and cast speed scale how often abilities fire', () => {
  const count = (caster: Partial<UnitDef>, id: string) => {
    const a = skillArena({ speed: 3.5, ...caster }, { gap: 1.2 });
    a.run(20);
    return a.events.filter((e) => e.type === 'attack' && e.weaponId === id).length;
  };
  const slow = count({ weaponId: 'sword' }, 'sword');
  const fast = count({ weaponId: 'sword', attackSpeed: 2 }, 'sword');
  assert.ok(fast >= slow * 1.8 && fast <= slow * 2.2, `sword ${slow} vs ${fast}`);
  const cast = count({ weaponId: 'noop', skillIds: ['set-chuoi'], speed: 0 }, 'set-chuoi');
  const quick = count({ weaponId: 'noop', skillIds: ['set-chuoi'], speed: 0, castSpeed: 2 }, 'set-chuoi');
  assert.ok(cast >= 2 && quick >= cast * 1.6, `chain ${cast} vs ${quick}`);
});

test('battles with every skill stay deterministic', () => {
  const run = () => {
    const a = skillArena({ weaponId: 'zap', skillIds: ['bao-sam', 'loc-xoay', 'mua-thien-thach', 'phun-lua', 'loat-dan', 'dam-dat'], speed: 3 }, { dummies: 30, gap: 14, seed: 5 });
    const sums: number[] = [];
    a.run(25, () => a.sim.tick % 30 === 0 && sums.push(a.sim.checksum()));
    return sums;
  };
  assert.deepEqual(run(), run());
});

test('stars raise HP and damage of one side only, deterministically', () => {
  const { terrain, armies } = botArmies('dong-co', 3);
  const blueIds = new Set(armies.blue.map((p) => p.unitId));
  const stars = { blue: Object.fromEntries([...blueIds].map((id) => [id, 3])) };
  const base = new BattleSim(SEED, terrain.map, terrain, armies, 9);
  const starred = new BattleSim(SEED, terrain.map, terrain, armies, 9, stars);
  const scale = 1 + SEED.settings.economy.starBonus * 3;
  starred.units.forEach((u, i) => {
    const plain = base.units[i];
    assert.equal(u.hp, u.side === 'blue' ? plain.hp * scale : plain.hp);
    assert.equal(u.weapon.damage, u.side === 'blue' ? plain.weapon.damage * scale : plain.weapon.damage);
  });
  const sums = (sim: BattleSim) => {
    const out: number[] = [];
    for (let i = 1; i <= 30 * 30; i++) {
      sim.step();
      if (i % 30 === 0) out.push(sim.checksum());
    }
    return out;
  };
  assert.deepEqual(sums(new BattleSim(SEED, terrain.map, terrain, armies, 9, stars)), sums(new BattleSim(SEED, terrain.map, terrain, armies, 9, stars)));
  assert.notDeepEqual(sums(starred), sums(base));
});

test('2-4 player deployment zones stay within map bounds and never overlap', () => {
  const layouts: Side[][] = [
    ['blue', 'red'],
    ['blue', 'red', 'green'],
    ['blue', 'red', 'green', 'yellow'],
  ];
  for (const map of SEED.maps) {
    for (const sides of layouts) {
      const terrain = new Terrain(map, SEED.assets, null, sides);
      const usable = map.size / 2 - EDGE_MARGIN;
      const zones = sides.map((s) => terrain.zoneOf(s));
      for (const z of zones) {
        assert.ok(z.x0 >= -usable - 1e-6 && z.x1 <= usable + 1e-6, `${map.id}/${sides.length}p: zone x out of bounds`);
        assert.ok(z.z0 >= -usable - 1e-6 && z.z1 <= usable + 1e-6, `${map.id}/${sides.length}p: zone z out of bounds`);
      }
      for (let i = 0; i < zones.length; i++) {
        for (let j = i + 1; j < zones.length; j++) {
          const a = zones[i];
          const b = zones[j];
          const overlaps = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
          assert.ok(!overlaps, `${map.id}/${sides.length}p: zones ${sides[i]}/${sides[j]} overlap`);
        }
      }
    }
  }
});

test('3-way FFA: last side standing wins the instant the other two are eliminated', () => {
  const ARENA: MapDef = { ...SEED.maps[0], id: 'ffa-arena', size: 120, heightScale: 0, river: { enabled: false, width: 8, meander: 0, ford: 0 }, trees: { perHectare: 0, kinds: [] }, rocks: { perHectare: 0, kinds: [] }, bushes: { perHectare: 0, kinds: [] } };
  const sides: Side[] = ['blue', 'red', 'green'];
  const terrain = new Terrain(ARENA, [], null, sides);
  const at = (side: Side) => {
    const z = terrain.zoneOf(side);
    return { x: (z.x0 + z.x1) / 2, z: (z.z0 + z.z1) / 2 };
  };
  const army = armies({ blue: [{ unitId: 'clubber', ...at('blue') }], red: [{ unitId: 'clubber', ...at('red') }], green: [{ unitId: 'clubber', ...at('green') }] });
  const sim = new BattleSim(SEED, ARENA, terrain, army, 1);
  sim.queueElimination('red', 1);
  sim.queueElimination('green', 1);
  sim.step();
  assert.equal(sim.result?.winner, 'blue');
  assert.equal(sim.result?.reason, 'eliminated');
  assert.deepEqual(sim.result?.survivors, { blue: 1, red: 0, green: 0 });
});

test('an elimination for a tick already simulated applies on the next step', () => {
  const ARENA: MapDef = { ...SEED.maps[0], id: 'late-elimination', size: 120, heightScale: 0, river: { enabled: false, width: 8, meander: 0, ford: 0 }, trees: { perHectare: 0, kinds: [] }, rocks: { perHectare: 0, kinds: [] }, bushes: { perHectare: 0, kinds: [] } };
  const sides: Side[] = ['blue', 'red', 'green'];
  const terrain = new Terrain(ARENA, [], null, sides);
  const at = (side: Side) => {
    const z = terrain.zoneOf(side);
    return { x: (z.x0 + z.x1) / 2, z: (z.z0 + z.z1) / 2 };
  };
  const army = armies({ blue: [{ unitId: 'clubber', ...at('blue') }], red: [{ unitId: 'clubber', ...at('red') }], green: [{ unitId: 'clubber', ...at('green') }] });
  const sim = new BattleSim(SEED, ARENA, terrain, army, 1);
  for (let i = 0; i < 10; i++) sim.step();
  sim.queueElimination('green', 4);
  sim.step();
  assert.equal(sim.aliveCount('green'), 0);
  assert.equal(sim.aliveCount('red'), 1);
});

test('3-way FFA: 2+ survivors when the time limit hits is a draw', () => {
  const ARENA: MapDef = { ...SEED.maps[0], id: 'ffa-arena-timeout', size: 160, heightScale: 0, river: { enabled: false, width: 8, meander: 0, ford: 0 }, trees: { perHectare: 0, kinds: [] }, rocks: { perHectare: 0, kinds: [] }, bushes: { perHectare: 0, kinds: [] } };
  const content = { ...SEED, settings: { ...SEED.settings, battleTimeLimit: 0.5 } };
  const sides: Side[] = ['blue', 'red', 'green'];
  const terrain = new Terrain(ARENA, [], null, sides);
  const at = (side: Side) => {
    const z = terrain.zoneOf(side);
    return { x: (z.x0 + z.x1) / 2, z: (z.z0 + z.z1) / 2 };
  };
  // Corners are far apart and the clock is short: nobody should reach anybody else in time.
  const army = armies({ blue: [{ unitId: 'clubber', ...at('blue') }], red: [{ unitId: 'clubber', ...at('red') }], green: [{ unitId: 'clubber', ...at('green') }] });
  const sim = new BattleSim(content, ARENA, terrain, army, 1);
  for (let i = 0; i < 30 * 5 && !sim.result; i++) sim.step();
  assert.equal(sim.result?.winner, 'draw');
  assert.equal(sim.result?.reason, 'timeout');
  assert.deepEqual(sim.result?.survivors, { blue: 1, red: 1, green: 1 });
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

const OPEN: MapDef = { ...SEED.maps[0], id: 'open', size: 80, heightScale: 0, river: { enabled: false, width: 8, meander: 0, ford: 0 }, trees: { perHectare: 0, kinds: [] }, rocks: { perHectare: 0, kinds: [] }, bushes: { perHectare: 0, kinds: [] } };
const TARGET: UnitDef = { ...SEED.units.find((u) => u.id === 'clubber')!, id: 'target', hp: 5000, speed: 0, weaponId: 'club' };
const WITH_TARGET = { ...SEED, units: [...SEED.units, TARGET] };

test('a big beast squeezes between two trees at the minimum spacing', () => {
  const terrain = new Terrain(OPEN);
  // Trunk surfaces 2 m apart: the closest terrain.ts ever places them.
  terrain.obstacles.push({ kind: 'tree', assetId: 'tree-pine', x: 0, y: 0, z: -1.8, radius: 0.8, scale: 1, yaw: 0, variant: 0 });
  terrain.obstacles.push({ kind: 'tree', assetId: 'tree-pine', x: 0, y: 0, z: 1.8, radius: 0.8, scale: 1, yaw: 0, variant: 0 });
  const sim = new BattleSim(WITH_TARGET, OPEN, terrain, armies({ blue: [{ unitId: 'mammoth', x: -12, z: 0 }], red: [{ unitId: 'target', x: 14, z: 0 }] }), 1);
  const beast = sim.units[0];
  for (let i = 0; i < 30 * 15; i++) sim.step();
  assert.ok(beast.x > 5, `stuck at x=${beast.x.toFixed(2)}`);
});

test('a low-flying breath unit closes in until its (3D) breath reaches ground targets', () => {
  const terrain = new Terrain(OPEN);
  const sim = new BattleSim(WITH_TARGET, OPEN, terrain, armies({ blue: [{ unitId: 'baby-dragon', x: -12, z: 0 }], red: [{ unitId: 'target', x: 12, z: 0 }] }), 1);
  const target = sim.units[1];
  for (let i = 0; i < 30 * 15; i++) sim.step();
  assert.ok(target.hp < target.def.hp, 'dragon never breathed on the target');
});

test('artillery shoots an enemy it can hit instead of backing away from one inside its minimum range', () => {
  const terrain = new Terrain(OPEN);
  const sim = new BattleSim(WITH_TARGET, OPEN, terrain, armies({ blue: [{ unitId: 'catapult', x: -10, z: 0 }], red: [{ unitId: 'target', x: -4, z: 0 }, { unitId: 'target', x: 20, z: 0 }] }), 1);
  const catapult = sim.units[0];
  for (let i = 0; i < 5; i++) sim.step();
  assert.equal(catapult.targetId, 2);
});

test('a trampling war platform closes to melee while its riders keep shooting', () => {
  const duel = (blueId: string) => {
    const terrain = new Terrain(OPEN);
    const sim = new BattleSim(SEED, OPEN, terrain, armies({ blue: [{ unitId: blueId, x: -15, z: 0 }], red: [{ unitId: 'archer', x: 15, z: 0 }] }), 1);
    let min = Infinity;
    for (let i = 0; i < 30 * 25; i++) {
      sim.step();
      const a = sim.units[0];
      const b = sim.units[1];
      if (!a.alive || !b.alive) break;
      min = Math.min(min, Math.hypot(a.x - b.x, a.z - b.z));
    }
    return min;
  };
  // Pure archers hold at bow range (~28 m); the elephant must push into contact instead.
  assert.ok(duel('archer') > 20, 'archers should hold at bow range');
  assert.ok(duel('war-elephant') < 10, 'war-elephant held at bow range instead of closing to trample');
});
