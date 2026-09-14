// Practice arena for previews: one caster against a block of passive training dummies on a
// small flat map. Content is built in memory from the live bundle plus the unsaved draft.
import type { AssetDef, ConfigBundle, MapDef, UnitDef, WeaponDef } from '@/shared/schema';
import { SEED } from '@/shared/seed';
import type { Armies } from './sim/army';
import { clamp } from './sim/rng';

export const ARENA_MAP_ID = '__arena';
const CASTER = '__caster';
const DUMMY = '__dummy';
const IDLE = '__idle';
const HOLD = '__hold';
const SPARRER = '__sparrer';
const SPAR = '__spar';

const map: MapDef = {
  ...SEED.maps[0],
  id: ARENA_MAP_ID,
  name: 'Đấu trường',
  seed: 5,
  size: 110,
  heightScale: 0.4,
  river: { enabled: false, width: 8, meander: 0, ford: 0 },
  trees: { perHectare: 0, kinds: [] },
  rocks: { perHectare: 0, kinds: [] },
  bushes: { perHectare: 0, kinds: [] },
  fog: 0,
  deployDepth: 20,
};

const dummyAsset: AssetDef = {
  id: DUMMY,
  name: 'Hình nộm',
  kind: 'humanoid',
  scale: 1,
  seed: 1,
  sculpt: null,
  params: { skin: '#d9b779', shirt: '#b8914f', pants: '#8a6a3a', boots: '#6b4f2a', armor: 'none', head: 'strawhat', headColor: '#e0c170', hair: 'none', brows: 'worried' },
};

const idle: WeaponDef = { ...SEED.weapons.find((w) => w.id === 'club')!, id: IDLE, name: 'Đứng yên', damage: 0, range: 0.3, cooldown: 60, windup: 0, knockback: 0, knockUp: 0, hitParticleId: null };
const spar: WeaponDef = { ...idle, id: SPAR, name: 'Tập đánh', damage: 14, range: 1.1, cooldown: 0.9, windup: 0.25, hitParticleId: 'hit-dust' };

/** A training dummy: plenty of hp, never moves, never hits back. */
function dummy(factionId: string): UnitDef {
  return { ...SEED.units[0], id: DUMMY, name: 'Hình nộm', factionId, cost: 1, hp: 2500, speed: 0, weaponId: IDLE, skillIds: [], modelId: DUMMY, riderModelId: null };
}

export interface Arena {
  bundle: ConfigBundle;
  armies: Armies;
  /** Where the camera should look (between caster and dummies). */
  centerX: number;
  span: number;
}

/**
 * Arena content: `caster` (a unit draft) against 9 dummies. `abilities` replace or add ability
 * documents (e.g. the ability being edited), so previews show unsaved changes.
 * A healer gets wounded allies instead: sparring partners keep hitting them.
 */
export function buildArena(bundle: ConfigBundle, caster: UnitDef, abilities: WeaponDef[] = []): Arena {
  const weapons = new Map(bundle.weapons.map((w) => [w.id, w]));
  for (const w of [...abilities, idle, spar]) weapons.set(w.id, w);
  const factionId = bundle.factions[0]?.id ?? 'arena';
  const unit: UnitDef = { ...caster, id: CASTER, cost: 1 };
  const own = [unit.weaponId, ...unit.skillIds].map((id) => weapons.get(id));
  const reach = Math.max(...own.map((w) => w?.range ?? 2));
  const healer = own.some((w) => w?.attack === 'heal');
  const gap = clamp(reach * 0.7, 6, 20);
  const block = (unitId: string, x: number) => Array.from({ length: 9 }, (_, i) => ({ unitId, x: x + (i % 3) * 1.35, z: (Math.floor(i / 3) - 1) * 1.35 }));
  // Healers: a line of allies, each held by a sparring partner.
  const line = (unitId: string, x: number) => Array.from({ length: 6 }, (_, i) => ({ unitId, x, z: (i - 2.5) * 1.3 }));
  const armies: Armies = healer
    ? { blue: [{ unitId: CASTER, x: -gap / 2 - 2, z: 0 }, ...line(DUMMY, -gap / 2 + 3)], red: line(SPARRER, -gap / 2 + 5.2) }
    : { blue: [{ unitId: CASTER, x: -gap / 2, z: 0 }], red: block(DUMMY, gap / 2) };
  const sparrer: UnitDef = { ...dummy(factionId), id: SPARRER, name: 'Người tập', hp: 100000, speed: 2.5, weaponId: SPAR };
  return {
    bundle: {
      ...bundle,
      version: `arena-${bundle.version}`,
      units: [...bundle.units.filter((u) => u.id !== CASTER && u.id !== DUMMY && u.id !== SPARRER), unit, dummy(factionId), sparrer],
      weapons: [...weapons.values()],
      assets: [...bundle.assets.filter((a) => a.id !== DUMMY), dummyAsset],
      maps: [map],
      settings: { ...bundle.settings, battleTimeLimit: 1800, friendlyFire: false },
    },
    armies,
    centerX: 1.4,
    span: gap + 3,
  };
}

/**
 * Caster that shows off one ability: as its basic attack, or as its only skill with a harmless
 * basic attack that keeps it standing at the skill's range. The first cast comes quickly.
 */
export function abilityCaster(bundle: ConfigBundle, ability: WeaponDef, asSkill: boolean, body?: UnitDef): { caster: UnitDef; abilities: WeaponDef[] } {
  // Borrow the body (model, rider, size, flight) of a unit that uses the ability.
  const base = body ?? bundle.units.find((u) => u.weaponId === ability.id || u.skillIds.includes(ability.id)) ?? { ...dummy(bundle.factions[0]?.id ?? 'arena'), modelId: bundle.assets.find((a) => a.kind === 'humanoid')?.id ?? DUMMY };
  const preview: WeaponDef = { ...ability, initialCooldown: Math.min(ability.initialCooldown, 0.8) };
  const hold: WeaponDef = { ...idle, id: HOLD, attack: 'projectile', projectileId: null, range: Math.max(4, ability.range * 0.85) };
  const caster: UnitDef = {
    ...base,
    id: CASTER,
    name: ability.name,
    hp: 100000,
    speed: base.speed || 3.5,
    knockbackResist: 1,
    attackSpeed: 1,
    castSpeed: 1,
    weaponId: asSkill ? HOLD : ability.id,
    skillIds: asSkill ? [ability.id] : [],
  };
  return { caster, abilities: asSkill ? [preview, hold] : [preview] };
}

/** Seconds a preview round needs to show an ability at least once. */
export function roundLength(abilities: WeaponDef[]): number {
  let t = 5;
  for (const w of abilities) {
    const effect = w.attack === 'vortex' ? w.duration : w.attack === 'strike' ? w.strikeDelay + w.strikeCount * w.strikeInterval : w.duration;
    t = Math.max(t, Math.min(w.initialCooldown, 0.8) + w.windup + effect + 3.5);
  }
  return Math.min(16, t);
}
