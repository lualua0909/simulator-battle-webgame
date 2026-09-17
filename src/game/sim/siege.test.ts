import assert from 'node:assert/strict';
import test from 'node:test';
import type { MapDef, UnitDef, WeaponDef } from '@/shared/schema';
import { SEED } from '@/shared/seed';
import { generateBotArmy } from '../bot/generate';
import { generateSiegeDefense, SIEGE_LAYOUTS } from '../bot/siege';
import { armies as fullArmies, snapToCell, validateArmy, type Armies, type Placement } from './army';
import { Terrain } from './terrain';
import { BattleSim, type SimEvent } from './world';

const ARENA: MapDef = { ...SEED.maps[0], id: 'arena', size: 80, heightScale: 0, river: { enabled: false, width: 8, meander: 0, ford: 0 }, trees: { perHectare: 0, kinds: [] }, rocks: { perHectare: 0, kinds: [] }, bushes: { perHectare: 0, kinds: [] } };
const NOOP: WeaponDef = { ...SEED.weapons.find((w) => w.id === 'club')!, id: 'noop', damage: 0, range: 0.3, cooldown: 60, knockback: 0 };
const DUMMY: UnitDef = { ...SEED.units.find((u) => u.id === 'clubber')!, id: 'dummy', hp: 5000, speed: 0, weaponId: 'noop' };
const CONTENT = { ...SEED, units: [...SEED.units, DUMMY], weapons: [...SEED.weapons, NOOP] };

/** Red defends by default. */
function siege(armies: Partial<Armies>, opts: { defense?: 'blue' | 'red' | null; seed?: number; content?: typeof CONTENT } = {}) {
  const terrain = new Terrain(ARENA, [], opts.defense === undefined ? 'red' : opts.defense);
  const sim = new BattleSim(opts.content ?? CONTENT, ARENA, terrain, fullArmies(armies), opts.seed ?? 7);
  const events: SimEvent[] = [];
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds * 30 && !sim.result; i++) {
      sim.step();
      events.push(...sim.events);
      each?.();
    }
  };
  return { sim, terrain, events, run };
}

const at = (unitId: string, x: number, z: number): Placement => ({ unitId, x, z });
const cell = (unitId: string, x: number, z: number, n = 1): Placement[] => Array.from({ length: n }, () => ({ unitId, ...snapToCell(x, z) }));
/** A north-south wall line at x, `tiers` high. */
const wallLine = (x: number, z0: number, z1: number, tiers = 3): Placement[] => {
  const out: Placement[] = [];
  for (let z = z0; z <= z1; z += 2) out.push(...cell('tuong-thanh', x, z, tiers));
  return out;
};
const core = at('nha-chinh', 28, 0);

test('wall blocks on one cell stack into one wall unit; defenders stand on top', () => {
  const { sim } = siege({ blue: [at('dummy', -20, 0)], red: [...cell('tuong-thanh', 9, 1, 3), { unitId: 'archer', ...snapToCell(9, 1) }, core] });
  const walls = sim.units.filter((u) => u.grid);
  assert.equal(walls.length, 1);
  const w = walls[0];
  assert.equal(w.wall!.tiers, 3);
  assert.equal(w.hp, 400 * 3);
  assert.equal(w.def.height, CONTENT.settings.siege.tierHeight * 3);
  const archer = sim.units.find((u) => u.def.id === 'archer')!;
  assert.equal(archer.onWall, w.wall);
  assert.equal(archer.y, w.wall!.top);
  // Wall blocks are not counted as army.
  assert.equal(sim.aliveCount('red'), 2);
});

test('melee attackers blocked by a wall break it tier by tier into rubble', () => {
  const blue = Array.from({ length: 4 }, (_, i) => at('giant', -4, -4 + i * 3));
  const a = siege({ blue, red: [...wallLine(9, -20, 20), at('dummy', 22, 0), core] });
  a.run(60);
  const breaks = a.events.filter((e): e is Extract<SimEvent, { type: 'wall-break' }> => e.type === 'wall-break');
  assert.ok(breaks.length >= 3, `breaks ${breaks.length}`);
  assert.ok(breaks.some((e) => e.tiers === 0), 'a cell must collapse');
  const rubble = [...a.sim.walls.values()].filter((c) => !c.unit.alive);
  assert.ok(rubble.length >= 1);
  // Somebody walked through the breach.
  assert.ok(a.sim.units.some((u) => u.side === 'blue' && u.alive && u.x > 10), 'attackers must pass the wall');
});

test('a defender falls when the wall under it collapses and takes fall damage', () => {
  const a = siege({ blue: [at('dummy', -20, 0)], red: [...cell('tuong-thanh', 9, 1, 3), { unitId: 'archer', ...snapToCell(9, 1) }, core] });
  const w = a.sim.units.find((u) => u.grid)!;
  const archer = a.sim.units.find((u) => u.def.id === 'archer')!;
  a.sim.step();
  w.hp = 1;
  (a.sim as unknown as { kill(v: unknown, nx: number, nz: number, f: number, up: number): void }).kill(w, 1, 0, 0, 0);
  let airborne = false;
  a.run(3, () => (airborne ||= archer.airborne));
  assert.ok(airborne, 'must fall');
  assert.equal(archer.onWall, null);
  assert.ok(archer.hp < archer.def.hp, `hp ${archer.hp}`);
});

test('a ninja climbs over the wall instead of breaking it', () => {
  const a = siege({ blue: [at('ninja', -4, 1)], red: [...wallLine(9, -10, 10), at('dummy', 20, 1), core] });
  const ninja = a.sim.units.find((u) => u.def.id === 'ninja')!;
  let climbed = false;
  let top = false;
  a.run(20, () => {
    climbed ||= ninja.climb !== null;
    top ||= ninja.onWall !== null;
  });
  assert.ok(climbed && top, `climbed ${climbed} top ${top}`);
  assert.ok(ninja.x > 11, `ninja x ${ninja.x}`);
  assert.equal(a.events.filter((e) => e.type === 'wall-break').length, 0);
});

test('barracks spawn one unit per second up to spawnMax alive', () => {
  const a = siege({ blue: [at('dummy', -30, 0)], red: [at('nha-linh', 26, 10), core] });
  a.run(4.1);
  const spawned = a.events.filter((e) => e.type === 'spawn').length;
  assert.equal(spawned, 4);
  a.run(20);
  const barracks = a.sim.units.find((u) => u.def.id === 'nha-linh')!;
  assert.equal(barracks.children.filter((c) => c.alive).length, 10);
});

test('defenders stay inside their zone', () => {
  const a = siege({ blue: [at('dummy', -20, 0)], red: [at('knight', 12, 0), at('knight', 14, 4), core] });
  const zone = a.terrain.zoneOf('red');
  let min = Infinity;
  a.run(15, () => {
    for (const u of a.sim.units) if (u.side === 'red' && u.alive) min = Math.min(min, u.x);
  });
  assert.ok(min >= zone.x0 - 1e-9, `left the zone: ${min} < ${zone.x0}`);
});

test('siege ends when the keep falls; timeout goes to the defenders; open battles time out as a draw', () => {
  const content = { ...CONTENT, settings: { ...CONTENT.settings, battleTimeLimit: 30 } };
  const kill = siege({ blue: [at('giant', 2, 0)], red: [at('nha-chinh', 12, 0), at('dummy', 30, 20)] }, { content });
  kill.sim.units.find((u) => u.def.structure === 'core')!.hp = 300;
  kill.run(31);
  assert.equal(kill.sim.result?.winner, 'blue');
  assert.equal(kill.sim.result?.reason, 'core');

  const hold = siege({ blue: [at('dummy', -30, 0)], red: [at('dummy', 30, 0), core] }, { content });
  hold.run(40);
  assert.deepEqual([hold.sim.result?.winner, hold.sim.result?.reason], ['red', 'timeout']);

  const open = siege({ blue: [at('dummy', -30, 0)], red: [at('dummy', 30, 0)] }, { content, defense: null });
  open.run(40);
  assert.deepEqual([open.sim.result?.winner, open.sim.result?.reason], ['draw', 'timeout']);
});

test('watchtower adds range to the units on it', () => {
  const a = siege({ blue: [at('dummy', -20, 0)], red: [{ unitId: 'thap-canh', ...snapToCell(9, 1) }, { unitId: 'archer', ...snapToCell(9, 1) }, core] });
  a.sim.step();
  const archer = a.sim.units.find((u) => u.def.id === 'archer')!;
  assert.equal(archer.onWall?.kind, 'platform');
  assert.equal(archer.rangeMul, 1 + SEED.settings.siege.towerRangeBonus);
  assert.equal(archer.y, 6);
});

test('siege army validation', () => {
  const terrain = new Terrain(ARENA, [], 'red');
  const check = (side: 'blue' | 'red', army: Placement[]) => validateArmy(CONTENT, terrain, side, army, 100000);
  assert.ok(check('red', [...wallLine(9, -4, 4), core]).ok);
  assert.match((check('red', [...wallLine(9, -4, 4)]) as { error: string }).error, /Nhà chính/);
  assert.match((check('red', [...cell('tuong-thanh', 9, 1, 4), core]) as { error: string }).error, /tầng/);
  assert.match((check('red', [at('tuong-thanh', 9.3, 1), core]) as { error: string }).error, /ô lưới/);
  assert.match((check('blue', [at('thap-cung', -10, 0)]) as { error: string }).error, /không dùng được/);
  assert.match((check('red', [at('ninja', 20, 0), core]) as { error: string }).error, /không dùng được/);
  assert.ok(check('blue', [at('ninja', -10, 0), at('nha-linh', -20, 0)]).ok);
  assert.match((check('red', [...cell('tuong-thanh', 20, 1), { unitId: 'nha-chinh', x: 20.5, z: 1 }]) as { error: string }).error, /đè lên tường/);
  const tower = snapToCell(15, 1);
  assert.match((check('red', [{ unitId: 'thap-canh', ...tower }, ...['archer', 'archer', 'archer'].map((id) => ({ unitId: id, ...tower })), core]) as { error: string }).error, /tháp canh/);
  // Open battles take no structures.
  const open = new Terrain(ARENA, [], null);
  assert.match((validateArmy(CONTENT, open, 'red', [core], 100000) as { error: string }).error, /không dùng được/);
});

test('sieges with every structure stay deterministic', () => {
  const run = () => {
    const blue = [at('ninja', -8, 0), at('ninja', -8, 3), at('fire-catapult', -20, 0), at('catapult', -20, 6), at('knight', -6, -4), at('nha-linh', -25, -10), at('archer', -10, 8)];
    const red = [...wallLine(10, -12, 12), at('thap-cung', 16, 8), at('thap-sung', 16, -8), at('tru-dien', 18, 0), { unitId: 'thap-canh', ...snapToCell(12, 15) }, { unitId: 'musketeer', ...snapToCell(12, 15) }, { unitId: 'archer', ...snapToCell(10, 2) }, at('nha-linh', 26, 12), core];
    const a = siege({ blue, red }, { seed: 3 });
    const sums: number[] = [];
    a.run(40, () => a.sim.tick % 30 === 0 && sums.push(a.sim.checksum()));
    return sums;
  };
  assert.deepEqual(run(), run());
});

test('bot siege defences are legal on every map and layout', () => {
  for (const map of SEED.maps) {
    const terrain = new Terrain(map, SEED.assets, 'red');
    for (const layout of SIEGE_LAYOUTS) {
      for (const bot of SEED.bots) {
        const army = generateSiegeDefense({ bot, content: SEED, terrain, side: 'red', budget: map.budget * 2, seed: 11, layout });
        const check = validateArmy(SEED, terrain, 'red', army, map.budget * 2);
        assert.ok(check.ok, `${map.id}/${layout}/${bot.id}: ${check.ok ? '' : check.error}`);
        assert.ok(army.some((p) => p.unitId === 'tuong-thanh'), `${map.id}/${layout}: no walls`);
      }
      const attack = generateBotArmy({ bot: SEED.bots[1], content: SEED, terrain, side: 'blue', budget: map.budget, seed: 3 });
      assert.ok(validateArmy(SEED, terrain, 'blue', attack, map.budget).ok);
    }
  }
});

test('ninja dash leaps onto an archer on the wall', () => {
  const a = siege({ blue: [at('ninja', -8, 1)], red: [...wallLine(9, -6, 6), { unitId: 'archer', ...snapToCell(9, 1) }, core] });
  a.run(8);
  const archer = a.sim.units.find((u) => u.def.id === 'archer')!;
  assert.ok(a.events.some((e) => e.type === 'attack' && e.weaponId === 'chem-luot'), 'dash must be cast');
  assert.ok(a.events.some((e) => e.type === 'hit' && e.weaponId === 'chem-luot' && e.targetId === archer.id), 'dash must hit the archer');
});

test('a deep river is crossed only at the ford', () => {
  const map: MapDef = { ...ARENA, id: 'ford', size: 120, river: { enabled: true, width: 10, meander: 0, ford: 12 } };
  const terrain = new Terrain(map, [], null);
  const sim = new BattleSim(CONTENT, map, terrain, fullArmies({ blue: [at('knight', -30, 30)], red: [at('dummy', 30, 30)] }), 5);
  const knight = sim.units[0];
  let deep = false;
  for (let i = 0; i < 30 * 40; i++) {
    sim.step();
    deep ||= terrain.deepWater(knight.x, knight.z);
  }
  assert.ok(!deep, 'walked into deep water');
  assert.ok(knight.x > terrain.riverX(knight.z), `still on the near bank at ${knight.x.toFixed(1)},${knight.z.toFixed(1)}`);
});
