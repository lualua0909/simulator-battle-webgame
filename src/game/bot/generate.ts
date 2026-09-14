// Bot army generator: composition by strategy (optionally countering the enemy army),
// then a formation inside the bot's deployment zone. Seeded, so repeatable.
import type { ArmorClass, BotDef, ContentBundle, Role, UnitDef, WeaponDef } from '@/shared/schema';
import { ARMOR_CLASSES, DAMAGE_TYPES } from '@/shared/schema';
import { canField, type Placement } from '../sim/army';
import { Rng, clamp } from '../sim/rng';
import type { Side, Terrain } from '../sim/terrain';

type Content = Pick<ContentBundle, 'units' | 'weapons' | 'settings'>;

const SHARES: Record<Exclude<BotDef['strategy'], 'counter'>, Record<Role, number>> = {
  balanced: { melee: 0.5, ranged: 0.3, support: 0.08, siege: 0.12 },
  rush: { melee: 0.85, ranged: 0.15, support: 0, siege: 0 },
  ranged: { melee: 0.35, ranged: 0.55, support: 0.1, siege: 0 },
  tank: { melee: 0.7, ranged: 0.2, support: 0.1, siege: 0 },
  swarm: { melee: 0.6, ranged: 0.4, support: 0, siege: 0 },
  elite: { melee: 0.55, ranged: 0.35, support: 0, siege: 0.1 },
};

interface Rated {
  unit: UnitDef;
  score: number;
}

export interface BotArmyOptions {
  bot: BotDef;
  content: Content;
  terrain: Terrain;
  side: Side;
  budget: number;
  enemy?: readonly Placement[];
  seed: number;
}

/** Rough damage (or healing) per second of one ability, counting the targets an area usually reaches. */
export function abilityDps(w: WeaponDef): number {
  let targets = w.attack === 'breath' ? 3 : w.cleaveArc > 0 ? Math.min(w.maxTargets, 1 + w.cleaveArc / 60) : 1;
  if (w.splashRadius > 0) targets *= 1 + w.splashRadius / 2;
  if (w.attack === 'chain') for (let j = 1, f = w.chainFalloff; j <= w.chainCount; j++, f *= w.chainFalloff) targets += f;
  let perCast = w.damage * w.volley * targets;
  if (w.attack === 'strike') perCast *= w.strikeCount;
  if (w.attack === 'vortex') perCast *= w.duration;
  else if (w.duration > 0) perCast *= 1 + w.duration / w.interval;
  perCast += w.burnDps * w.burnDuration * targets;
  const dps = perCast / Math.max(0.05, w.cooldown);
  return w.attack === 'heal' ? dps * 0.8 : dps;
}

export function unitPower(unit: UnitDef, content: Content): { dps: number; ehp: number } {
  const weapons = new Map(content.weapons.map((x) => [x.id, x]));
  const w = weapons.get(unit.weaponId);
  let dps = w ? abilityDps(w) * unit.attackSpeed : 0;
  for (const id of unit.skillIds) {
    const skill = weapons.get(id);
    if (skill) dps += abilityDps(skill) * unit.castSpeed;
  }
  let taken = 0;
  for (const d of DAMAGE_TYPES) taken += content.settings.damageMatrix[d][unit.armorClass];
  const ehp = unit.hp / Math.max(0.1, taken / DAMAGE_TYPES.length);
  return { dps, ehp };
}

export function generateBotArmy(opts: BotArmyOptions): Placement[] {
  const { bot, content, terrain, side, budget } = opts;
  const rng = new Rng(opts.seed);
  // Structures are placed by the siege layout, not bought here.
  const pool = content.units.filter((u) => u.structure === 'none' && canField(u, side, terrain.defense) && (bot.factionIds.length === 0 || bot.factionIds.includes(u.factionId)));
  if (pool.length === 0) return [];

  const { shares, bonus } = bot.strategy === 'counter' ? counterPlan(opts) : { shares: SHARES[bot.strategy], bonus: () => 1 };
  const sharpness = 0.5 + bot.difficulty * 0.4;
  const rated: Rated[] = pool.map((unit) => {
    const { dps, ehp } = unitPower(unit, content);
    let score = Math.sqrt(Math.max(1e-3, dps) * ehp) / unit.cost;
    if (bot.strategy === 'rush') score *= unit.speed;
    if (bot.strategy === 'tank') score *= Math.sqrt(ehp / unit.cost);
    if (bot.strategy === 'swarm') score /= Math.sqrt(unit.cost);
    if (bot.strategy === 'elite') score *= Math.sqrt(unit.cost);
    return { unit, score: score * bonus(unit) };
  });
  const maxScore = Math.max(...rated.map((r) => r.score));
  for (const r of rated) r.score = Math.pow(r.score / maxScore, sharpness);

  const maxCount = Math.min(bot.maxUnits, content.settings.maxUnitsPerSide);
  const maxSingle = budget * (bot.strategy === 'elite' ? 0.6 : 0.35);
  const spentByRole: Record<Role, number> = { melee: 0, ranged: 0, support: 0, siege: 0 };
  const picked: UnitDef[] = [];
  let remaining = budget;

  while (picked.length < maxCount) {
    // Units above the per-unit cap are only allowed when nothing cheaper fits an empty army.
    const cheap = rated.filter((r) => r.unit.cost <= remaining && r.unit.cost <= maxSingle);
    const affordable = cheap.length > 0 || picked.length > 0 ? cheap : rated.filter((r) => r.unit.cost <= remaining);
    if (affordable.length === 0) break;
    const spent = budget - remaining;
    const roles = new Set(affordable.map((r) => r.unit.role));
    let role: Role | null = null;
    let deficit = -Infinity;
    for (const candidate of roles) {
      const want = shares[candidate];
      if (want <= 0) continue;
      const have = spent > 0 ? spentByRole[candidate] / spent : 0;
      const d = want - have + rng.next() * bot.randomness * 0.3;
      if (d > deficit) {
        deficit = d;
        role = candidate;
      }
    }
    const group = affordable.filter((r) => r.unit.role === (role ?? affordable[0].unit.role));
    const unit = weightedPick(group, bot.randomness, rng);
    picked.push(unit);
    spentByRole[unit.role] += unit.cost;
    remaining -= unit.cost;
  }

  return layout(picked, bot.formation, terrain, side, rng);
}

function weightedPick(group: Rated[], randomness: number, rng: Rng): UnitDef {
  let total = 0;
  const weights = group.map((r) => {
    const w = r.score * (1 - randomness) + randomness * 0.5;
    total += w;
    return w;
  });
  let roll = rng.next() * total;
  for (let i = 0; i < group.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return group[i].unit;
  }
  return group[group.length - 1].unit;
}

function counterPlan(opts: BotArmyOptions): { shares: Record<Role, number>; bonus: (u: UnitDef) => number } {
  const { content } = opts;
  const byId = new Map(content.units.map((u) => [u.id, u]));
  const enemy = (opts.enemy ?? []).map((p) => byId.get(p.unitId)).filter((u): u is UnitDef => !!u);
  const shares = { ...SHARES.balanced };
  if (enemy.length === 0) return { shares, bonus: () => 1 };

  let total = 0;
  let ranged = 0;
  let melee = 0;
  let flying = 0;
  const armor: Record<ArmorClass, number> = { unarmored: 0, light: 0, heavy: 0, beast: 0, siege: 0 };
  for (const u of enemy) {
    total += u.cost;
    if (u.role === 'ranged' || u.role === 'siege') ranged += u.cost;
    if (u.role === 'melee') melee += u.cost;
    if (u.flying) flying += u.cost;
    armor[u.armorClass] += u.cost;
  }
  const rangedShare = ranged / total;
  const meleeShare = melee / total;
  const flyingShare = flying / total;
  if (rangedShare > 0.4) {
    shares.melee += 0.2;
    shares.ranged -= 0.1;
  }
  if (meleeShare > 0.6) {
    shares.ranged += 0.2;
    shares.siege += 0.05;
    shares.melee -= 0.25;
  }
  if (flyingShare > 0.2) shares.ranged += 0.25;

  const weapons = new Map(content.weapons.map((w) => [w.id, w]));
  const bonus = (u: UnitDef): number => {
    const w = weapons.get(u.weaponId);
    let b = 1;
    if (w && w.attack !== 'heal') {
      let eff = 0;
      for (const a of ARMOR_CLASSES) eff += (armor[a] / total) * content.settings.damageMatrix[w.damageType][a];
      b *= eff * eff;
    }
    if (rangedShare > 0.4 && (u.blockChance > 0 || u.speed > 5 || u.flying)) b *= 1.5;
    if (flyingShare > 0.2) {
      if (w && (w.attack === 'projectile' || w.attack === 'breath' || w.attack === 'chain' || w.attack === 'strike' || u.flying)) b *= 1.6;
      else if (w?.attack === 'melee') b *= 0.6;
    }
    return b;
  };
  for (const k of Object.keys(shares) as Role[]) shares[k] = Math.max(0, shares[k]);
  return { shares, bonus };
}

// ------------------------------------------------------------------ formations

const ROLE_RANK: Record<Role, number> = { melee: 0, support: 1, ranged: 2, siege: 3 };

function layout(units: UnitDef[], formation: BotDef['formation'], terrain: Terrain, side: Side, rng: Rng): Placement[] {
  const zone = terrain.zones[side];
  const dir = side === 'blue' ? -1 : 1; // from the front line back into the zone
  const front = side === 'blue' ? zone.x1 - 1.5 : zone.x0 + 1.5;
  const back = side === 'blue' ? zone.x0 + 1 : zone.x1 - 1;
  const zMin = zone.z0 + 1.5;
  const zMax = zone.z1 - 1.5;
  const width = zMax - zMin;
  const out: Placement[] = [];
  const put = (u: UnitDef, x: number, z: number) => {
    out.push({
      unitId: u.id,
      x: clamp(x, Math.min(front, back), Math.max(front, back)),
      z: clamp(z, zMin, zMax),
    });
  };

  if (formation === 'scatter') {
    for (const u of units) put(u, rng.range(zone.x0 + 1, zone.x1 - 1), rng.range(zMin, zMax));
    return out;
  }
  if (formation === 'blob') {
    const cz = rng.range(-width * 0.15, width * 0.15);
    const radius = Math.min(width * 0.35, 4 + Math.sqrt(units.length) * 1.4);
    const sorted = [...units].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);
    sorted.forEach((u, i) => {
      const [dx, dz] = rng.disk();
      const depth = (i / Math.max(1, sorted.length)) * radius * 1.4;
      put(u, front + dir * (depth + Math.abs(dx) * 2), cz + dz * radius);
    });
    return out;
  }

  const groups = new Map<number, UnitDef[]>();
  for (const u of units) {
    const rank = ROLE_RANK[u.role];
    if (!groups.has(rank)) groups.set(rank, []);
    groups.get(rank)!.push(u);
  }
  let depth = 0;
  for (const rank of [...groups.keys()].sort()) {
    // Big units in the middle of each group.
    const group = groups.get(rank)!.sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id));
    const spacing = Math.max(1.3, ...group.map((u) => u.radius * 2.3));
    const perRow = Math.max(1, Math.floor((formation === 'wedge' ? width * 0.7 : width * 0.85) / spacing));
    for (let i = 0; i < group.length; i++) {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, group.length - row * perRow);
      const col = i % perRow;
      const centered = col % 2 === 0 ? col / 2 : -(col + 1) / 2; // 0, -1, 1, -2, 2...
      let z = centered * spacing + (inRow % 2 === 0 ? spacing / 2 : 0);
      let x = front + dir * (depth + row * spacing);
      if (formation === 'wedge' && rank === 0) x += dir * Math.abs(centered) * spacing * 0.6;
      if (formation === 'flanks' && rank === 0) z += (centered >= 0 ? 1 : -1) * width * 0.22;
      z += rng.range(-0.3, 0.3);
      x += rng.range(-0.3, 0.3);
      put(group[i], x, z);
    }
    const rows = Math.ceil(group.length / perRow);
    depth += rows * spacing + 1.5;
  }
  return out;
}
