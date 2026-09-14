// Deterministic fixed-step battle simulation.
//
// Rules for determinism (online peers simulate independently from the same seed):
// only + - * / Math.sqrt Math.floor Math.round on doubles, the seeded Rng, fixed
// iteration order (spawn order), no Math.random / trig / Date. Cosmetics (ragdolls,
// particles, animation) live in the renderer and never feed back into this file.
import { starScale } from '@/shared/economy';
import type { ContentBundle, MapDef, ProjectileDef, UnitDef, WeaponDef } from '@/shared/schema';
import type { Armies, Side } from './army';
import { Rng, clamp, dcos, fnv1a } from './rng';
import { EDGE_MARGIN, WALL_CELL, type Obstacle, Terrain, wallIndex } from './terrain';

export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;

const CELL = 3;
const RETARGET_TICKS = 10;
const TURN_RATE = 0.3;
const ACCEL = 0.25;
const GROUND_REACH = 2.6;
const WATER_SLOW = 0.55;
const DEG = 0.017453292519943295;
/** A skill whose conditions fail looks again after this long. */
const SKILL_RETRY = 0.3;
/** Damage-over-time reports one `hit` event per this many ticks per unit. */
const DOT_EVENT_TICKS = 6;
/** Falls shorter than this do no damage. */
const SAFE_FALL = 2.5;

export type SimEvent =
  | { type: 'hit'; x: number; y: number; z: number; dx: number; dz: number; weaponId: string; targetId: number; blocked: boolean; damage: number }
  | { type: 'death'; unitId: number; dx: number; dy: number; dz: number; force: number }
  /** One release of an ability (every pulse of a channel). */
  | { type: 'attack'; unitId: number; weaponId: string; x: number; y: number; z: number; dx: number; dy: number; dz: number }
  /** A skill starts its cast time. */
  | { type: 'cast'; unitId: number; weaponId: string; duration: number }
  | { type: 'launch'; projectileId: number }
  | { type: 'impact'; defId: string; x: number; y: number; z: number; ground: boolean; dx: number; dy: number; dz: number; stuck: boolean }
  | { type: 'heal'; x: number; y: number; z: number; targetId: number; weaponId: string }
  | { type: 'land'; unitId: number; x: number; y: number; z: number }
  /** Chain lightning: caster → targets[0] → targets[1] … */
  | { type: 'chain'; unitId: number; weaponId: string; targets: number[] }
  /** A strike will land at (x, z) after `delay` seconds. */
  | { type: 'warn'; unitId: number; weaponId: string; x: number; y: number; z: number; radius: number; delay: number }
  | { type: 'strike'; weaponId: string; x: number; y: number; z: number; radius: number }
  | { type: 'nova'; unitId: number; weaponId: string; x: number; y: number; z: number; radius: number }
  | { type: 'zone-end'; zoneId: number; weaponId: string; x: number; y: number; z: number; radius: number }
  /** A wall cell lost blocks: `tiers` remain (0 = collapsed into rubble). */
  | { type: 'wall-break'; unitId: number; tiers: number; lost: number; x: number; y: number; z: number; dx: number; dz: number }
  /** A barracks produced a unit. */
  | { type: 'spawn'; unitId: number; parentId: number };

/** One ability of a unit: its basic attack (index 0) or a skill. */
export class SimAbility {
  readonly cosHalfArc: number;

  constructor(
    readonly def: WeaponDef,
    readonly projectile: ProjectileDef | null,
    readonly skill: boolean,
    /** attackSpeed (basic) or castSpeed (skill) of the owner. */
    readonly rate: number,
    public cooldown: number,
  ) {
    this.cosHalfArc = dcos(def.cleaveArc * 0.5 * DEG);
  }
}

export class SimUnit {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx = 0;
  vz = 0;
  kx = 0;
  kz = 0;
  vy = 0;
  fx: number;
  fz: number;
  hp: number;
  alive = true;
  targetId = -1;
  retargetIn = 0;
  /** Ability being wound up or channelled. */
  action: SimAbility | null = null;
  /** Last ability released (drives the follow-through animation). */
  lastAction: SimAbility;
  actionTargetId = -1;
  windupLeft = -1;
  windupTotal = 0;
  channelLeft = 0;
  channelNext = 0;
  lastAttackTick = -1000;
  chargeSpeed = 0;
  stun = 0;
  burnLeft = 0;
  burnDps = 0;
  airborne = false;
  flyHeight: number;
  deathTick = -1;
  /** Grid structure state (walls, watchtowers). */
  wall: WallCell | null = null;
  /** Wall cell the unit stands on. */
  onWall: WallCell | null = null;
  /** Enemy wall cell being climbed. */
  climb: WallCell | null = null;
  /** Height a fall from a wall started at (NaN = not falling from a wall). */
  fallY = NaN;
  /** Range multiplier (watchtower bonus). */
  rangeMul = 1;
  /** Dash skill in flight: the target struck on landing. */
  dashTargetId = -1;
  dashWeapon: WeaponDef | null = null;
  /** Barracks: seconds to the next unit and the units it produced. */
  spawnLeft = 0;
  readonly children: SimUnit[] = [];

  constructor(
    readonly id: number,
    readonly side: Side,
    readonly def: UnitDef,
    readonly abilities: readonly SimAbility[],
    x: number,
    z: number,
    y: number,
  ) {
    this.x = this.px = x;
    this.z = this.pz = z;
    this.flyHeight = def.flying ? def.altitude : 0;
    this.y = this.py = y + this.flyHeight;
    this.fx = side === 'blue' ? 1 : -1;
    this.fz = 0;
    this.hp = def.hp;
    this.lastAction = abilities[0];
  }

  /** Basic attack (movement and targeting follow it). */
  get weapon(): WeaponDef {
    return this.abilities[0].def;
  }

  get flying(): boolean {
    return this.def.flying;
  }

  get radius(): number {
    return this.def.radius;
  }

  get mass(): number {
    return this.def.mass;
  }

  get structure(): boolean {
    return this.def.structure !== 'none';
  }

  /** Walls and watchtowers: grid blocks, not fighters. */
  get grid(): boolean {
    return this.wall !== null;
  }

  /** Planar speed (steering + knockback). */
  speed(): number {
    const x = this.vx + this.kx;
    const z = this.vz + this.kz;
    return Math.sqrt(x * x + z * z);
  }
}

export class SimProjectile {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  age = 0;
  alive = true;

  constructor(
    readonly id: number,
    readonly side: Side,
    readonly ownerId: number,
    readonly def: ProjectileDef,
    readonly weapon: WeaponDef,
    x: number,
    y: number,
    z: number,
    public vx: number,
    public vy: number,
    public vz: number,
    readonly damageMul: number,
  ) {
    this.x = this.px = x;
    this.y = this.py = y;
    this.z = this.pz = z;
  }
}

/** One 2×2 m grid cell holding a wall stack or a watchtower (its HP lives on `unit`). */
export class WallCell {
  constructor(
    readonly unit: SimUnit,
    readonly ix: number,
    readonly iz: number,
    readonly kind: 'wall' | 'platform',
    /** HP of one block; a wall loses a tier per `blockHp` of damage. */
    readonly blockHp: number,
    public tiers: number,
  ) {}

  get top(): number {
    return this.unit.y + this.unit.def.height;
  }

  get x0(): number {
    return this.ix * WALL_CELL;
  }

  get z0(): number {
    return this.iz * WALL_CELL;
  }
}

/** A whirlwind travelling over the battlefield. */
export class SimZone {
  px: number;
  pz: number;
  vx = 0;
  vz = 0;
  age = 0;
  alive = true;
  targetId: number;

  constructor(
    readonly id: number,
    readonly side: Side,
    readonly ownerId: number,
    readonly weapon: WeaponDef,
    public x: number,
    public z: number,
    targetId: number,
  ) {
    this.px = x;
    this.pz = z;
    this.targetId = targetId;
  }

  get radius(): number {
    return Math.max(0.5, this.weapon.splashRadius);
  }
}

interface SimStrike {
  x: number;
  y: number;
  z: number;
  tick: number;
  side: Side;
  weapon: WeaponDef;
}

export interface BattleResult {
  winner: Side | 'draw';
  tick: number;
  /** `core`: the defenders' keep fell (siege mode). */
  reason: 'eliminated' | 'timeout' | 'core';
  survivors: Record<Side, number>;
}

type SimContent = Pick<ContentBundle, 'units' | 'weapons' | 'projectiles' | 'settings'>;

export class BattleSim {
  readonly units: SimUnit[] = [];
  projectiles: SimProjectile[] = [];
  zones: SimZone[] = [];
  readonly events: SimEvent[] = [];
  tick = 0;
  result: BattleResult | null = null;

  private readonly rng: Rng;
  private readonly grid = new Map<number, SimUnit[]>();
  private readonly obstacleGrid = new Map<number, Obstacle[]>();
  private strikes: SimStrike[] = [];
  private nextProjectileId = 1;
  private nextZoneId = 1;
  private readonly timeLimitTicks: number;
  /** Siege mode: the defending side (null = open battle). */
  readonly defense: Side | null;
  /** Grid structure cells (rubble stays) by cell key. */
  readonly walls = new Map<number, WallCell>();
  private readonly unitDefs: Map<string, UnitDef>;
  private readonly weaponDefs: Map<string, WeaponDef>;
  private readonly projectileDefs: Map<string, ProjectileDef>;
  private readonly stars: Partial<Record<Side, Readonly<Record<string, number>>>>;

  constructor(
    private readonly content: SimContent,
    readonly map: MapDef,
    readonly terrain: Terrain,
    armies: Armies,
    seed: number,
    /** Star level per unit id for each side: HP and damage grow by settings.economy.starBonus per star. */
    stars: Partial<Record<Side, Readonly<Record<string, number>>>> = {},
  ) {
    this.rng = new Rng(seed);
    this.defense = terrain.defense;
    this.stars = stars;
    this.timeLimitTicks = Math.round(content.settings.battleTimeLimit * SIM_HZ);
    this.unitDefs = new Map(content.units.map((u) => [u.id, u]));
    this.weaponDefs = new Map(content.weapons.map((w) => [w.id, w]));
    this.projectileDefs = new Map(content.projectiles.map((p) => [p.id, p]));
    const tierHeight = content.settings.siege.tierHeight;
    for (const side of ['blue', 'red'] as const) {
      // Wall blocks placed on the same cell stack into one wall unit.
      const stacks = new Map<number, number>();
      for (const p of armies[side]) {
        const base = this.unitDefs.get(p.unitId);
        if (!base || (base.structure !== 'wall' && base.structure !== 'platform')) continue;
        const key = cellKey(wallIndex(p.x), wallIndex(p.z));
        stacks.set(key, (stacks.get(key) ?? 0) + 1);
      }
      for (const p of armies[side]) {
        const base = this.unitDefs.get(p.unitId);
        if (!base) continue;
        if (base.structure !== 'wall' && base.structure !== 'platform') {
          this.createUnit(side, base, p.x, p.z);
          continue;
        }
        const ix = wallIndex(p.x);
        const iz = wallIndex(p.z);
        const key = cellKey(ix, iz);
        if (this.walls.has(key)) continue;
        const kind = base.structure;
        const blocks = kind === 'wall' ? Math.min(stacks.get(key) ?? 1, content.settings.siege.maxTiers) : 1;
        const cx = (ix + 0.5) * WALL_CELL;
        const cz = (iz + 0.5) * WALL_CELL;
        const u = this.createUnit(side, base, cx, cz, (def) => ({ ...def, hp: def.hp * blocks, height: kind === 'wall' ? blocks * tierHeight : def.height }));
        if (!u) continue;
        u.wall = new WallCell(u, ix, iz, kind, u.def.hp / blocks, blocks);
        this.walls.set(key, u.wall);
      }
    }
    // Units placed on a wall or watchtower start on top of it.
    for (const u of this.units) {
      if (u.structure || u.flying) continue;
      const cell = this.cellAt(u.x, u.z);
      if (cell && cell.unit.side === u.side) {
        u.onWall = cell;
        u.y = u.py = cell.top;
      }
    }
    for (const o of terrain.obstacles) {
      if (o.radius <= 0) continue;
      const key = cellKey(Math.floor(o.x / CELL), Math.floor(o.z / CELL));
      let list = this.obstacleGrid.get(key);
      if (!list) this.obstacleGrid.set(key, (list = []));
      list.push(o);
    }
  }

  get time(): number {
    return this.tick * SIM_DT;
  }

  /** Adds a unit (placement or barracks spawn) with its star bonus; `shape` adjusts the def (wall stacks). */
  private createUnit(side: Side, base: UnitDef, x: number, z: number, shape?: (def: UnitDef) => UnitDef): SimUnit | null {
    const weapon = this.weaponDefs.get(base.weaponId);
    if (!weapon) return null;
    const projectileOf = (w: WeaponDef) => (w.projectileId ? this.projectileDefs.get(w.projectileId) ?? null : null);
    const scale = starScale(this.stars[side]?.[base.id] ?? 0, this.content.settings.economy.starBonus);
    const powered = <T extends object>(def: T, patch: (d: T) => Partial<T>): T => (scale === 1 ? def : { ...def, ...patch(def) });
    let def = powered(base, (u) => ({ hp: u.hp * scale, trampleDamage: u.trampleDamage * scale }));
    if (shape) def = shape(def);
    const strong = (w: WeaponDef) => powered(w, (x) => ({ damage: x.damage * scale, burnDps: x.burnDps * scale }));
    const id = this.units.length;
    // Stagger first attacks so a line does not swing in perfect unison.
    const abilities = [new SimAbility(strong(weapon), projectileOf(weapon), false, def.attackSpeed, (id % 7) * 0.05)];
    for (const skillId of def.skillIds) {
      const skill = this.weaponDefs.get(skillId);
      if (skill) abilities.push(new SimAbility(strong(skill), projectileOf(skill), true, def.castSpeed, skill.initialCooldown / def.castSpeed + (id % 5) * 0.1));
    }
    const u = new SimUnit(id, side, def, abilities, x, z, this.terrain.height(x, z));
    u.spawnLeft = def.spawnInterval;
    this.units.push(u);
    return u;
  }

  /** Grid cell (wall, watchtower or rubble) under a point. */
  cellAt(x: number, z: number): WallCell | undefined {
    return this.walls.size === 0 ? undefined : this.walls.get(cellKey(wallIndex(x), wallIndex(z)));
  }

  unit(id: number): SimUnit | undefined {
    return this.units[id];
  }

  /** Alive units and buildings of a side (wall blocks and watchtowers not counted). */
  aliveCount(side: Side): number {
    let n = 0;
    for (const u of this.units) if (u.alive && u.side === side && !u.grid) n++;
    return n;
  }

  // ------------------------------------------------------------------ step

  step(): void {
    this.events.length = 0;
    this.tick++;
    for (const u of this.units) {
      u.px = u.x;
      u.py = u.y;
      u.pz = u.z;
    }
    for (const p of this.projectiles) {
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
    }
    this.buildGrid();
    for (const u of this.units) if (u.alive && !u.grid) this.updateTarget(u);
    for (const u of this.units) if (u.alive && !u.structure) this.steer(u);
    this.updateZones();
    for (const u of this.units) if (u.alive && !u.structure) this.integrate(u);
    this.resolveCollisions();
    for (const u of this.units) if (u.alive) this.updateStatus(u);
    for (const u of this.units) if (u.alive && !u.grid) this.updateAttack(u);
    this.updateProjectiles();
    this.updateStrikes();
    this.updateWalls();
    this.updateSpawns();
    if (!this.result) this.checkEnd();
  }

  checksum(): number {
    const v: number[] = [this.tick];
    for (const u of this.units) {
      v.push(u.alive ? 1 : 0, Math.round(u.x * 1000), Math.round(u.y * 1000), Math.round(u.z * 1000), Math.round(u.hp * 100));
    }
    for (const p of this.projectiles) v.push(p.id, Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000));
    for (const zn of this.zones) v.push(zn.id, Math.round(zn.x * 1000), Math.round(zn.z * 1000));
    for (const s of this.strikes) v.push(s.tick, Math.round(s.x * 1000), Math.round(s.z * 1000));
    return fnv1a(v);
  }

  // ------------------------------------------------------------------ spatial grid

  private buildGrid(): void {
    for (const list of this.grid.values()) list.length = 0;
    for (const u of this.units) {
      if (!u.alive) continue;
      const key = cellKey(Math.floor(u.x / CELL), Math.floor(u.z / CELL));
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(u);
    }
  }

  /** Alive units whose cell intersects the square around (x, z). Order is deterministic. */
  private near(x: number, z: number, r: number, out: SimUnit[]): SimUnit[] {
    out.length = 0;
    const cx0 = Math.floor((x - r) / CELL);
    const cx1 = Math.floor((x + r) / CELL);
    const cz0 = Math.floor((z - r) / CELL);
    const cz1 = Math.floor((z + r) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.grid.get(cellKey(cx, cz));
        if (list) for (const u of list) out.push(u);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ targeting

  private updateTarget(u: SimUnit): void {
    const current = this.units[u.targetId];
    const heal = u.weapon.attack === 'heal';
    if (current && current.alive && --u.retargetIn > 0) {
      if (!heal || current.side === u.side) return;
    }
    u.retargetIn = RETARGET_TICKS + (u.id % 5);
    u.targetId = heal ? this.pickHealTarget(u) : this.pickEnemy(u);
  }

  private pickEnemy(u: SimUnit): number {
    const groundOnly = u.weapon.attack === 'melee' && !u.flying;
    // Siege engines prefer buildings and walls; everyone else ignores walls until nothing else is left.
    const breaker = u.def.role === 'siege';
    let best = -1;
    let bestD = Infinity;
    let bestAny = -1;
    let bestAnyD = Infinity;
    let bestWall = -1;
    let bestWallD = Infinity;
    for (const v of this.units) {
      if (!v.alive || v.side === u.side) continue;
      const dx = v.x - u.x;
      const dz = v.z - u.z;
      let d = dx * dx + dz * dz;
      if (breaker && v.structure) d *= 0.25;
      if (v.grid && !breaker) {
        if (d < bestWallD) {
          bestWallD = d;
          bestWall = v.id;
        }
        continue;
      }
      if (d < bestAnyD) {
        bestAnyD = d;
        bestAny = v.id;
      }
      if (groundOnly && v.flying) continue;
      if (d < bestD) {
        bestD = d;
        best = v.id;
      }
    }
    return best >= 0 ? best : bestAny >= 0 ? bestAny : bestWall;
  }

  private pickHealTarget(u: SimUnit): number {
    let best = -1;
    let bestScore = Infinity;
    let follow = -1;
    let followD = Infinity;
    for (const v of this.units) {
      if (!v.alive || v.side !== u.side || v === u || v.structure) continue;
      const dx = v.x - u.x;
      const dz = v.z - u.z;
      const d = dx * dx + dz * dz;
      const ratio = v.hp / v.def.hp;
      if (ratio < 0.999 && d < 900) {
        const score = ratio * 400 + d;
        if (score < bestScore) {
          bestScore = score;
          best = v.id;
        }
      }
      if (v.weapon.attack !== 'heal' && d < followD) {
        followD = d;
        follow = v.id;
      }
    }
    return best >= 0 ? best : follow;
  }

  // ------------------------------------------------------------------ movement

  private steer(u: SimUnit): void {
    let dvx = 0;
    let dvz = 0;
    if (u.stun > 0 || u.airborne || u.climb) {
      u.vx *= u.climb ? 0 : 0.8;
      u.vz *= u.climb ? 0 : 0.8;
      return;
    }
    // Casting a skill or channelling: stand still and face the action's target.
    const busy = u.action !== null && (u.channelLeft > 0 || (u.action.skill && u.windupLeft >= 0));
    const t = this.units[busy ? u.actionTargetId : u.targetId] ?? this.units[u.targetId];
    if (t && t.alive) {
      const dx = t.x - u.x;
      const dz = t.z - u.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 1e-6) {
        let nx = dx / dist;
        let nz = dz / dist;
        // A deep river between the unit and its target: head for the ford first.
        const t0 = this.terrain;
        if (t0.ford > 0 && !u.flying) {
          const half = t0.ford / 2 - u.radius - 0.5;
          const west = u.x < t0.riverX(u.z);
          if (west !== t.x < t0.riverX(t.z)) {
            if (u.z > half || u.z < -half) {
              // To the ford entrance on this bank…
              const fx = t0.riverX(0) + (west ? -1 : 1) * (t0.riverHalfWidth + 2) - u.x;
              const fz = clamp(u.z, -half + 0.5, half - 0.5) - u.z;
              const fl = Math.sqrt(fx * fx + fz * fz) || 1;
              nx = fx / fl;
              nz = fz / fl;
            } else {
              // …then straight across.
              nx = west ? 1 : -1;
              nz = 0;
            }
          }
        }
        let want = 0;
        const w = u.weapon;
        if (busy) want = 0;
        else if (w.attack === 'heal') {
          const keep = t.side === u.side && t.hp < t.def.hp ? w.range * 0.7 : 4 + u.radius + t.radius;
          if (dist > keep) want = 1;
        } else if (isRanged(w)) {
          if (dist > w.range * u.rangeMul * 0.95) want = 1;
          else if (dist < w.minRange) want = -1;
        } else {
          const reach = w.range + u.radius + t.radius;
          if (dist > reach * 0.9) want = 1;
        }
        const water = !u.flying && this.terrain.inWater(u.x, u.z) ? WATER_SLOW : 1;
        const rubble = !u.flying && !u.onWall && this.cellAt(u.x, u.z)?.unit.alive === false ? this.content.settings.siege.rubbleSlow : 1;
        const sp = u.def.speed * water * rubble * want;
        dvx = nx * sp;
        dvz = nz * sp;
        this.turnTowards(u, nx, nz);
      }
      if (u.flying) {
        const close = dist < 10 && (u.weapon.attack === 'melee' || u.weapon.attack === 'breath');
        const desired = close && u.weapon.attack === 'melee' ? (t.flying ? t.flyHeight : 1.2) : u.def.altitude;
        u.flyHeight += (desired - u.flyHeight) * 0.08;
      }
    } else if (u.flying) {
      u.flyHeight += (u.def.altitude - u.flyHeight) * 0.05;
    }
    u.vx += (dvx - u.vx) * ACCEL;
    u.vz += (dvz - u.vz) * ACCEL;
  }

  private turnTowards(u: SimUnit, nx: number, nz: number): void {
    let fx = u.fx + (nx - u.fx) * TURN_RATE;
    let fz = u.fz + (nz - u.fz) * TURN_RATE;
    let len = Math.sqrt(fx * fx + fz * fz);
    if (len < 1e-4) {
      // Exactly opposite: turn sideways first.
      fx = -u.fz;
      fz = u.fx;
      len = 1;
    }
    u.fx = fx / len;
    u.fz = fz / len;
  }

  private integrate(u: SimUnit): void {
    const g = this.content.settings.gravity;
    if (u.climb) {
      this.climbStep(u, u.climb);
      return;
    }
    if (u.airborne) {
      u.x += u.kx * SIM_DT;
      u.z += u.kz * SIM_DT;
      u.y += u.vy * SIM_DT;
      u.vy -= g * SIM_DT;
      u.kx *= 0.995;
      u.kz *= 0.995;
      this.clampBounds(u);
      // Land on a wall top when coming down onto it, otherwise on the ground.
      const cell = this.cellAt(u.x, u.z);
      const onTop = !!cell && cell.unit.alive && u.y - u.vy * SIM_DT >= cell.top - 0.3;
      const ground = onTop ? cell!.top : this.terrain.height(u.x, u.z);
      if (u.y <= ground) {
        u.y = ground;
        u.airborne = false;
        u.onWall = onTop ? cell! : null;
        if (u.dashWeapon) this.dashLand(u, u.dashWeapon);
        else u.stun = Math.max(u.stun, 0.5 + Math.min(1.5, -u.vy * 0.1));
        u.vy = 0;
        u.kx *= 0.4;
        u.kz *= 0.4;
        this.events.push({ type: 'land', unitId: u.id, x: u.x, y: u.y, z: u.z });
        const drop = u.fallY - ground;
        u.fallY = NaN;
        if (drop > SAFE_FALL && !u.def.climbWalls) this.fallDamage(u, (drop - SAFE_FALL) * this.content.settings.siege.fallDamage);
      }
      return;
    }
    u.x += (u.vx + u.kx) * SIM_DT;
    u.z += (u.vz + u.kz) * SIM_DT;
    u.kx *= 0.82;
    u.kz *= 0.82;
    if (u.stun > 0) u.stun -= SIM_DT;
  }

  /** Climbing an enemy wall: rise at climbSpeed, then step onto its top. */
  private climbStep(u: SimUnit, cell: WallCell): void {
    if (!cell.unit.alive || u.stun > 0) {
      u.climb = null;
      this.startFall(u);
      return;
    }
    u.y += this.content.settings.siege.climbSpeed * SIM_DT;
    if (u.y < cell.top) return;
    u.climb = null;
    u.y = cell.top;
    u.onWall = cell;
    const m = Math.min(0.4, WALL_CELL * 0.5);
    u.x = clamp(u.x, cell.x0 + m, cell.x0 + WALL_CELL - m);
    u.z = clamp(u.z, cell.z0 + m, cell.z0 + WALL_CELL - m);
    this.events.push({ type: 'land', unitId: u.id, x: u.x, y: u.y, z: u.z });
  }

  /** Leap at a target: a ballistic jump (onto wall tops too) ending in a strike. */
  private dash(u: SimUnit, w: WeaponDef, t: SimUnit | undefined): void {
    if (!t || !t.alive || t.side === u.side || u.airborne) return;
    const dx = t.x - u.x;
    const dz = t.z - u.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 1e-6) return;
    const stop = Math.max(0, dist - (u.radius + t.radius + 0.3));
    const g = this.content.settings.gravity;
    // Long enough to be coming down at the end (so it lands on a wall top instead of overshooting).
    const rise = t.y + 0.8 - u.y;
    const T = Math.max(0.45, stop / 12, rise > 0 ? Math.sqrt((2 * rise) / g) * 1.2 : 0);
    // Airborne drift decays 0.5 % per tick: aim for the distance actually covered.
    let cover = 0;
    for (let i = 0, f = 1, n = Math.round(T * SIM_HZ); i < n; i++, f *= 0.995) cover += f;
    const drift = Math.max(0.5, cover / Math.max(1, Math.round(T * SIM_HZ)));
    u.climb = null;
    u.onWall = null;
    u.airborne = true;
    u.fallY = NaN;
    u.kx = ((dx / dist) * stop) / T / drift;
    u.kz = ((dz / dist) * stop) / T / drift;
    u.vx = 0;
    u.vz = 0;
    // Aim a little above the target so the leap comes down onto it (and onto wall tops).
    u.vy = (t.y + 0.8 - u.y + 0.5 * g * T * T) / T;
    u.dashTargetId = t.id;
    u.dashWeapon = w;
  }

  private dashLand(u: SimUnit, w: WeaponDef): void {
    const t = this.units[u.dashTargetId];
    u.dashTargetId = -1;
    u.dashWeapon = null;
    u.kx *= 0.2;
    u.kz *= 0.2;
    if (!t || !t.alive || t.side === u.side) return;
    const dx = t.x - u.x;
    const dz = t.z - u.z;
    const reach = u.radius + t.radius + 1.8;
    if (dx * dx + dz * dz <= reach * reach && this.verticalReach(u, t)) this.meleeHit(u, w, t, w.damage);
  }

  /** Drops off a wall (its block broke, or the unit walked off the edge). */
  private startFall(u: SimUnit): void {
    u.onWall = null;
    u.airborne = true;
    u.vy = 0;
    u.fallY = u.y;
    u.windupLeft = -1;
    u.channelLeft = 0;
    u.action = null;
  }

  private fallDamage(u: SimUnit, amount: number): void {
    if (amount <= 0 || !u.alive) return;
    u.hp -= amount;
    this.events.push({ type: 'hit', x: u.x, y: u.y + u.def.height * 0.3, z: u.z, dx: 0, dz: 0, weaponId: '', targetId: u.id, blocked: false, damage: amount });
    if (u.hp <= 0) this.kill(u, -u.fx, -u.fz, 0, 0);
  }

  private clampBounds(u: SimUnit): void {
    const lim = this.terrain.half - EDGE_MARGIN * 0.5;
    u.x = clamp(u.x, -lim, lim);
    u.z = clamp(u.z, -lim, lim);
  }

  private scratch: SimUnit[] = [];
  private scratch2: SimUnit[] = [];

  private resolveCollisions(): void {
    const near = this.scratch;
    for (const u of this.units) {
      if (!u.alive) continue;
      this.near(u.x, u.z, u.radius + 6, near);
      if (u.grid || u.climb) continue;
      for (const v of near) {
        if (v.id <= u.id || !v.alive || v.grid || v.climb) continue;
        if (u.flying !== v.flying || u.airborne || v.airborne) continue;
        // On a wall and below it do not push each other.
        if (u.onWall !== v.onWall && (u.y - v.y > 1.2 || v.y - u.y > 1.2)) continue;
        let dx = v.x - u.x;
        let dz = v.z - u.z;
        const min = u.radius + v.radius;
        let d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        if (d2 < 1e-8) {
          dx = 1;
          dz = 0;
          d2 = 1e-4;
        }
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const overlap = min - d;
        const total = u.mass + v.mass;
        // Buildings never move.
        const pu = u.structure ? 0 : v.structure ? overlap * 0.8 : overlap * (v.mass / total) * 0.8;
        const pv = v.structure ? 0 : u.structure ? overlap * 0.8 : overlap * (u.mass / total) * 0.8;
        u.x -= nx * pu;
        u.z -= nz * pu;
        v.x += nx * pv;
        v.z += nz * pv;
        if (u.side !== v.side) {
          this.trample(u, v, nx, nz);
          this.trample(v, u, -nx, -nz);
        }
      }
    }
    const siege = this.content.settings.siege;
    for (const u of this.units) {
      if (!u.alive || u.structure || u.climb) continue;
      if (!u.flying) {
        if (!u.onWall) this.pushOutOfObstacles(u);
        this.pushOutOfWalls(u);
        if (!u.airborne && this.terrain.ford > 0 && this.terrain.deepWater(u.x, u.z)) this.pushToBank(u);
      }
      if (this.defense === u.side && !u.onWall && !u.airborne) this.leash(u);
      this.clampBounds(u);
      u.rangeMul = u.onWall?.kind === 'platform' ? 1 + siege.towerRangeBonus : 1;
      if (u.airborne) continue;
      if (u.onWall) {
        const cell = u.onWall;
        if (!cell.unit.alive || u.y > cell.top + 0.3) this.startFall(u);
        else u.y = cell.top;
        continue;
      }
      const ground = this.terrain.height(u.x, u.z);
      u.y = u.flying ? ground + u.flyHeight : ground;
    }
  }

  /** Out of deep water onto the nearer bank. */
  private pushToBank(u: SimUnit): void {
    const rx = this.terrain.riverX(u.z);
    const edge = this.terrain.riverHalfWidth + 0.01;
    u.x = u.px < rx ? rx - edge : rx + edge;
  }

  /** Defenders never leave their zone. */
  private leash(u: SimUnit): void {
    const zone = this.terrain.zones[u.side];
    u.x = clamp(u.x, zone.x0, zone.x1);
    u.z = clamp(u.z, zone.z0, zone.z1);
  }

  /**
   * Wall cells are solid boxes up to their top. Units on a wall walk along connected cells
   * (defenders stop at the edge, attackers drop off); units below are pushed out, and an
   * attacker blocked by an enemy wall climbs it (climbWalls) or starts breaking it.
   */
  private pushOutOfWalls(u: SimUnit): void {
    if (this.walls.size === 0) return;
    const tierHeight = this.content.settings.siege.tierHeight;
    if (u.onWall) {
      const from = u.onWall;
      const cell = this.cellAt(u.x, u.z);
      if (cell === from) return;
      const dy = cell ? cell.top - from.top : 0;
      if (cell && cell.unit.alive && dy <= tierHeight + 0.01 && -dy <= tierHeight + 0.01) {
        u.onWall = cell;
        return;
      }
      if (u.side === this.defense) {
        u.x = clamp(u.x, from.x0 + 0.05, from.x0 + WALL_CELL - 0.05);
        u.z = clamp(u.z, from.z0 + 0.05, from.z0 + WALL_CELL - 0.05);
      } else this.startFall(u);
      return;
    }
    const r = u.radius;
    for (let ix = wallIndex(u.x - r); ix <= wallIndex(u.x + r); ix++) {
      for (let iz = wallIndex(u.z - r); iz <= wallIndex(u.z + r); iz++) {
        const cell = this.walls.get(cellKey(ix, iz));
        if (!cell || !cell.unit.alive || u.y >= cell.top - 0.3) continue;
        // A dash onto a wall top vaults over the face of the target's cell.
        if (u.dashWeapon && this.units[u.dashTargetId]?.onWall === cell) continue;
        const x0 = cell.x0;
        const z0 = cell.z0;
        const x1 = x0 + WALL_CELL;
        const z1 = z0 + WALL_CELL;
        const cx = clamp(u.x, x0, x1);
        const cz = clamp(u.z, z0, z1);
        const dx = u.x - cx;
        const dz = u.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          u.x = cx + (dx / d) * r;
          u.z = cz + (dz / d) * r;
        } else {
          // Centre inside the box: leave through the nearest face.
          const left = u.x - x0;
          const right = x1 - u.x;
          const back = u.z - z0;
          const front = z1 - u.z;
          const m = Math.min(left, right, back, front);
          if (m === left) u.x = x0 - r;
          else if (m === right) u.x = x1 + r;
          else if (m === back) u.z = z0 - r;
          else u.z = z1 + r;
        }
        if (cell.unit.side === u.side || u.airborne) continue;
        if (u.def.climbWalls) {
          u.climb = cell;
          u.vx = 0;
          u.vz = 0;
          u.kx = 0;
          u.kz = 0;
          const fx = x0 + WALL_CELL * 0.5 - u.x;
          const fz = z0 + WALL_CELL * 0.5 - u.z;
          const len = Math.sqrt(fx * fx + fz * fz);
          if (len > 1e-6) {
            u.fx = fx / len;
            u.fz = fz / len;
          }
          return;
        }
        if (u.targetId !== cell.unit.id) {
          u.targetId = cell.unit.id;
          u.retargetIn = 60;
        }
      }
    }
  }

  private trample(attacker: SimUnit, victim: SimUnit, nx: number, nz: number): void {
    const dmg = attacker.def.trampleDamage;
    if (dmg <= 0 || !victim.alive) return;
    const sp = attacker.speed();
    if (sp < 1) return;
    victim.hp -= dmg * SIM_DT * this.multiplier('blunt', victim);
    this.applyKnock(victim, nx, nz, attacker.mass * sp * 0.04, 0);
    if (victim.hp <= 0) this.kill(victim, nx, nz, attacker.mass * sp * 0.1, 2);
  }

  private pushOutOfObstacles(u: SimUnit): void {
    const cx = Math.floor(u.x / CELL);
    const cz = Math.floor(u.z / CELL);
    for (let ix = cx - 2; ix <= cx + 2; ix++) {
      for (let iz = cz - 2; iz <= cz + 2; iz++) {
        const list = this.obstacleGrid.get(cellKey(ix, iz));
        if (!list) continue;
        for (const o of list) {
          const dx = u.x - o.x;
          const dz = u.z - o.z;
          const min = o.radius + u.radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min || d2 < 1e-8) continue;
          const d = Math.sqrt(d2);
          u.x = o.x + (dx / d) * min;
          u.z = o.z + (dz / d) * min;
        }
      }
    }
  }

  // ------------------------------------------------------------------ status effects

  private updateStatus(u: SimUnit): void {
    if (u.burnLeft <= 0) return;
    u.burnLeft -= SIM_DT;
    u.hp -= u.burnDps * SIM_DT * this.multiplier('fire', u);
    if (u.hp <= 0) this.kill(u, -u.fx, -u.fz, 0, 0);
    if (u.burnLeft <= 0) u.burnDps = 0;
  }

  private applyStatus(v: SimUnit, w: WeaponDef): void {
    if (!v.alive) return;
    if (w.stunDuration > 0) {
      v.stun = Math.max(v.stun, w.stunDuration);
      v.windupLeft = -1;
      v.channelLeft = 0;
      v.action = null;
    }
    if (w.burnDuration > 0 && w.burnDps > 0) {
      v.burnLeft = Math.max(v.burnLeft, w.burnDuration);
      v.burnDps = Math.max(v.burnDps, w.burnDps);
    }
  }

  // ------------------------------------------------------------------ combat

  private updateAttack(u: SimUnit): void {
    for (const a of u.abilities) a.cooldown -= SIM_DT;
    if (u.stun > 0 || u.airborne) {
      u.windupLeft = -1;
      u.channelLeft = 0;
      u.action = null;
      return;
    }
    const act = u.action;
    if (act && u.channelLeft > 0) {
      u.channelLeft -= SIM_DT;
      u.channelNext -= SIM_DT;
      if (u.channelNext <= 0) {
        u.channelNext += act.def.interval / act.rate;
        this.pulse(u, act);
      }
      if (u.channelLeft <= 0) u.action = null;
      return;
    }
    if (act && u.windupLeft >= 0) {
      u.windupLeft -= SIM_DT;
      if (u.windupLeft <= 0) this.execute(u, act);
      return;
    }
    for (let i = 1; i < u.abilities.length; i++) {
      const a = u.abilities[i];
      if (a.cooldown > 0) continue;
      const target = this.skillTarget(u, a);
      if (target < 0) {
        a.cooldown = SKILL_RETRY;
        continue;
      }
      this.begin(u, a, target);
      return;
    }
    const base = u.abilities[0];
    const t = this.units[u.targetId];
    if (!t || !t.alive || base.cooldown > 0 || !this.inRange(u, base.def, t)) return;
    if (base.def.attack === 'heal' && (t.side !== u.side || t.hp >= t.def.hp)) return;
    this.begin(u, base, t.id);
  }

  private begin(u: SimUnit, a: SimAbility, targetId: number): void {
    u.action = a;
    u.actionTargetId = targetId;
    u.chargeSpeed = u.speed();
    const windup = a.def.windup / a.rate;
    if (a.skill) this.events.push({ type: 'cast', unitId: u.id, weaponId: a.def.id, duration: windup });
    if (windup <= 0) {
      this.execute(u, a);
      return;
    }
    u.windupLeft = windup;
    u.windupTotal = windup;
  }

  private execute(u: SimUnit, a: SimAbility): void {
    u.windupLeft = -1;
    a.cooldown = a.def.cooldown / a.rate;
    u.lastAttackTick = this.tick;
    u.lastAction = a;
    if (a.def.duration > 0 && a.def.attack !== 'vortex') {
      u.channelLeft = a.def.duration;
      u.channelNext = a.def.interval / a.rate;
      this.pulse(u, a);
      return;
    }
    u.action = null;
    this.pulse(u, a);
  }

  /** Target a skill would be cast at now, or -1 (out of range, not enough targets, nobody hurt). */
  private skillTarget(u: SimUnit, a: SimAbility): number {
    const w = a.def;
    if (w.attack === 'heal') return this.healSkillTarget(u, w);
    if (w.attack === 'dash') return u.airborne || u.climb ? -1 : this.dashTarget(u, w);
    if (w.attack === 'nova') return this.countEnemies(u.x, u.y + u.def.height * 0.5, u.z, w.splashRadius, u.side) >= w.minTargets ? u.id : -1;
    const t = this.units[u.targetId];
    if (!t || !t.alive || t.side === u.side) return -1;
    if (w.minTargets <= 1) return this.inRange(u, w, t) ? t.id : -1;
    // Area skills pick the densest enemy group in range.
    const r = clusterRadius(w);
    let best = -1;
    let bestCount = 0;
    let bestD = Infinity;
    const candidates = this.near(u.x, u.z, w.range + 1, this.scratch2);
    for (const c of candidates) {
      if (!c.alive || c.side === u.side || !this.inRange(u, w, c)) continue;
      const n = this.countEnemies(c.x, c.y + c.def.height * 0.5, c.z, r, u.side);
      const d = (c.x - u.x) * (c.x - u.x) + (c.z - u.z) * (c.z - u.z);
      if (n > bestCount || (n === bestCount && (d < bestD || (d === bestD && c.id < best)))) {
        best = c.id;
        bestCount = n;
        bestD = d;
      }
    }
    return bestCount >= w.minTargets ? best : -1;
  }

  /** Nearest enemy in leap range, archers and wall defenders first. */
  private dashTarget(u: SimUnit, w: WeaponDef): number {
    let best = -1;
    let bestScore = Infinity;
    for (const v of this.units) {
      if (!v.alive || v.side === u.side || v.structure || v.flying) continue;
      const dx = v.x - u.x;
      const dz = v.z - u.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > w.range * w.range || d2 < w.minRange * w.minRange) continue;
      const score = d2 - (isRanged(v.weapon) ? 60 : 0) - (v.onWall ? 120 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = v.id;
      }
    }
    return best;
  }

  private healSkillTarget(u: SimUnit, w: WeaponDef): number {
    let best = -1;
    let bestScore = Infinity;
    const near = this.near(u.x, u.z, w.range + 1, this.scratch2);
    for (const v of near) {
      if (!v.alive || v.side !== u.side || v.hp >= v.def.hp || v.structure) continue;
      const dx = v.x - u.x;
      const dz = v.z - u.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > w.range * w.range) continue;
      if (w.minTargets > 1 && this.countHurtAllies(v, w.splashRadius) < w.minTargets) continue;
      const score = (v.hp / v.def.hp) * 400 + d2;
      if (score < bestScore || (score === bestScore && v.id < best)) {
        bestScore = score;
        best = v.id;
      }
    }
    return best;
  }

  private countEnemies(x: number, y: number, z: number, r: number, side: Side): number {
    let n = 0;
    const near = this.near(x, z, r + 4, this.scratch);
    for (const v of near) {
      if (!v.alive || v.side === side || v.grid) continue;
      const dx = v.x - x;
      const dz = v.z - z;
      const reach = r + v.def.radius;
      const dy = v.y + v.def.height * 0.5 - y;
      if (dx * dx + dz * dz <= reach * reach && (dy < 0 ? -dy : dy) <= Math.max(GROUND_REACH, r)) n++;
    }
    return n;
  }

  private countHurtAllies(center: SimUnit, r: number): number {
    let n = 0;
    const near = this.near(center.x, center.z, r + 4, this.scratch);
    for (const v of near) {
      if (!v.alive || v.side !== center.side || v.hp >= v.def.hp || v.structure) continue;
      const dx = v.x - center.x;
      const dz = v.z - center.z;
      if (dx * dx + dz * dz <= (r + v.def.radius) * (r + v.def.radius)) n++;
    }
    return n;
  }

  private inRange(u: SimUnit, w: WeaponDef, t: SimUnit): boolean {
    const dx = t.x - u.x;
    const dz = t.z - u.z;
    const d2 = dx * dx + dz * dz;
    switch (w.attack) {
      case 'projectile':
      case 'strike':
      case 'vortex': {
        const range = w.range * u.rangeMul;
        return d2 <= range * range && d2 >= w.minRange * w.minRange;
      }
      case 'heal':
        return d2 <= w.range * w.range;
      case 'dash':
        return d2 <= w.range * w.range && d2 >= w.minRange * w.minRange;
      case 'chain':
      case 'breath': {
        const dy = t.y + t.def.height * 0.5 - (u.y + u.def.height * (w.attack === 'breath' ? 0 : 0.7));
        const r = w.range * (w.attack === 'chain' ? u.rangeMul : 1) + t.def.radius;
        return d2 + dy * dy <= r * r;
      }
      default: {
        const reach = w.range + u.def.radius + t.def.radius;
        return d2 <= reach * reach && this.verticalReach(u, t);
      }
    }
  }

  private verticalReach(u: SimUnit, t: SimUnit): boolean {
    const dy = t.y + t.def.height * 0.5 - (u.y + u.def.height * 0.5);
    return (dy < 0 ? -dy : dy) <= Math.max(GROUND_REACH, u.def.height * 0.75);
  }

  /** One release of an ability: every channel pulse calls this again. */
  private pulse(u: SimUnit, a: SimAbility): void {
    const w = a.def;
    let t = this.units[u.actionTargetId];
    const wantsAlly = w.attack === 'heal';
    if (u.actionTargetId !== u.id && (!t || !t.alive || (t.side === u.side) !== wantsAlly)) {
      // The target died during the windup or channel: switch to the current one.
      const alt = this.units[u.targetId];
      if (alt && alt.alive) {
        t = alt;
        u.actionTargetId = alt.id;
      }
    }
    let dx = u.fx;
    let dy = 0;
    let dz = u.fz;
    if (t && t !== u) {
      const tx = t.x - u.x;
      const ty = t.y + t.def.height * 0.5 - (u.y + u.def.height * 0.7);
      const tz = t.z - u.z;
      const len = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      dx = tx / len;
      dy = ty / len;
      dz = tz / len;
    }
    this.events.push({ type: 'attack', unitId: u.id, weaponId: w.id, x: u.x, y: u.y + u.def.height * 0.7, z: u.z, dx, dy, dz });

    switch (w.attack) {
      case 'heal':
        if (t && t.alive && t.side === u.side) this.heal(u, w, t);
        return;
      case 'projectile':
        if (t && t.alive && t.side !== u.side) for (let i = 0; i < w.volley; i++) this.launch(u, a, t);
        return;
      case 'chain':
        if (t && t.alive && t.side !== u.side) this.chain(u, w, t);
        return;
      case 'strike':
        this.strike(u, w, t && t.alive && t.side !== u.side ? t : undefined);
        return;
      case 'vortex':
        this.vortex(u, w);
        return;
      case 'nova':
        this.nova(u, w);
        return;
      case 'dash':
        this.dash(u, w, t);
        return;
      default:
        this.cleave(u, a, t, dx, dy, dz);
    }
  }

  private cleave(u: SimUnit, a: SimAbility, t: SimUnit | undefined, dx: number, dy: number, dz: number): void {
    const w = a.def;
    const charge = this.chargeMultiplier(u);
    const cone = w.attack === 'breath' || w.cleaveArc > 0;
    if (!cone) {
      if (t && t.alive && t.side !== u.side && this.inRangeLoose(u, w, t)) this.meleeHit(u, w, t, w.damage * charge);
      return;
    }
    // Cleave / breath: every enemy inside the arc, nearest first.
    const near = this.near(u.x, u.z, w.range + u.def.radius + 6, this.scratch.slice(0, 0));
    const hits: Array<{ v: SimUnit; d: number }> = [];
    for (const v of near) {
      if (!v.alive || v.side === u.side) continue;
      const vx = v.x - u.x;
      const vz = v.z - u.z;
      const d = Math.sqrt(vx * vx + vz * vz);
      if (w.attack === 'breath') {
        const vy = v.y + v.def.height * 0.5 - u.y;
        const d3 = Math.sqrt(d * d + vy * vy);
        if (d3 > w.range + v.def.radius) continue;
        const dot = d3 > 1e-6 ? (vx * dx + vy * dy + vz * dz) / d3 : 1;
        if (dot < a.cosHalfArc) continue;
        hits.push({ v, d: d3 });
      } else {
        if (d > w.range + u.def.radius + v.def.radius || !this.verticalReach(u, v)) continue;
        const dot = d > 1e-6 ? (vx * u.fx + vz * u.fz) / d : 1;
        if (dot < a.cosHalfArc) continue;
        hits.push({ v, d });
      }
    }
    hits.sort((p, q) => p.d - q.d || p.v.id - q.v.id);
    const n = Math.min(w.maxTargets, hits.length);
    for (let i = 0; i < n; i++) this.meleeHit(u, w, hits[i].v, w.damage * charge);
  }

  private heal(u: SimUnit, w: WeaponDef, t: SimUnit): void {
    if (w.splashRadius > 0) this.events.push({ type: 'nova', unitId: u.id, weaponId: w.id, x: t.x, y: t.y, z: t.z, radius: w.splashRadius });
    const list = w.splashRadius > 0 ? this.near(t.x, t.z, w.splashRadius + 4, this.scratch2) : [t];
    for (const v of list) {
      if (!v.alive || v.side !== t.side || v.hp >= v.def.hp || v.structure) continue;
      if (v !== t) {
        const dx = v.x - t.x;
        const dz = v.z - t.z;
        if (dx * dx + dz * dz > (w.splashRadius + v.def.radius) * (w.splashRadius + v.def.radius)) continue;
      }
      v.hp = Math.min(v.def.hp, v.hp + w.damage);
      this.events.push({ type: 'heal', x: v.x, y: v.y + v.def.height * 0.6, z: v.z, targetId: v.id, weaponId: w.id });
    }
  }

  /** Lightning that hits the target, then jumps to the nearest enemy not yet hit. */
  private chain(u: SimUnit, w: WeaponDef, first: SimUnit): void {
    const targets: number[] = [];
    let cur: SimUnit | null = first;
    let amount = w.damage;
    let fromX = u.x;
    let fromZ = u.z;
    for (let jump = 0; jump <= w.chainCount && cur; jump++) {
      const hit: SimUnit = cur;
      targets.push(hit.id);
      let nx = hit.x - fromX;
      let nz = hit.z - fromZ;
      const len = Math.sqrt(nx * nx + nz * nz);
      if (len > 1e-6) {
        nx /= len;
        nz /= len;
      } else {
        nx = u.fx;
        nz = u.fz;
      }
      this.damage(hit, amount, w, nx, nz, 1);
      fromX = hit.x;
      fromZ = hit.z;
      amount *= w.chainFalloff;
      cur = null;
      let bestD = Infinity;
      const near = this.near(hit.x, hit.z, w.chainRange + 2, this.scratch2);
      for (const v of near) {
        if (!v.alive || v.side === u.side || targets.includes(v.id)) continue;
        const dx = v.x - hit.x;
        const dz = v.z - hit.z;
        const dy = v.y - hit.y;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > w.chainRange * w.chainRange) continue;
        if (d2 < bestD || (d2 === bestD && cur !== null && v.id < (cur as SimUnit).id)) {
          bestD = d2;
          cur = v;
        }
      }
    }
    this.events.push({ type: 'chain', unitId: u.id, weaponId: w.id, targets });
  }

  /** Schedules blasts from the sky around the target (telegraphed by `warn`). */
  private strike(u: SimUnit, w: WeaponDef, t: SimUnit | undefined): void {
    let x = u.x + u.fx * Math.min(w.range, 8);
    let z = u.z + u.fz * Math.min(w.range, 8);
    if (t) {
      // Lead a moving target a little.
      x = t.x + (t.vx + t.kx) * w.strikeDelay * 0.5;
      z = t.z + (t.vz + t.kz) * w.strikeDelay * 0.5;
    }
    const lim = this.terrain.half - EDGE_MARGIN;
    for (let k = 0; k < w.strikeCount; k++) {
      let sx = x;
      let sz = z;
      if (k > 0 && w.strikeSpread > 0) {
        const [ox, oz] = this.rng.disk();
        sx += ox * w.strikeSpread;
        sz += oz * w.strikeSpread;
      }
      sx = clamp(sx, -lim, lim);
      sz = clamp(sz, -lim, lim);
      const sy = this.terrain.height(sx, sz);
      const tick = this.tick + Math.max(1, Math.round((w.strikeDelay + k * w.strikeInterval) * SIM_HZ));
      this.strikes.push({ x: sx, y: sy, z: sz, tick, side: u.side, weapon: w });
      this.events.push({ type: 'warn', unitId: u.id, weaponId: w.id, x: sx, y: sy, z: sz, radius: w.splashRadius, delay: (tick - this.tick) * SIM_DT });
    }
  }

  private updateStrikes(): void {
    if (this.strikes.length === 0) return;
    let keep = 0;
    const pending = this.strikes;
    for (const s of pending) {
      if (s.tick > this.tick) {
        pending[keep++] = s;
        continue;
      }
      this.events.push({ type: 'strike', weaponId: s.weapon.id, x: s.x, y: s.y, z: s.z, radius: s.weapon.splashRadius });
      // A column of energy: it reaches flyers above the blast too.
      this.blast(s.x, s.y, s.z, s.weapon, s.side, 1, true);
    }
    pending.length = keep;
  }

  /** Shockwave around the caster (enemies only). */
  private nova(u: SimUnit, w: WeaponDef): void {
    const cy = u.y + u.def.height * 0.5;
    this.events.push({ type: 'nova', unitId: u.id, weaponId: w.id, x: u.x, y: u.y, z: u.z, radius: w.splashRadius });
    const charge = this.chargeMultiplier(u);
    const near = this.near(u.x, u.z, w.splashRadius + 4, this.scratch2.slice(0, 0));
    for (const v of near) {
      if (!v.alive || v.side === u.side) continue;
      const vx = v.x - u.x;
      const vz = v.z - u.z;
      const d = Math.sqrt(vx * vx + vz * vz);
      const reach = w.splashRadius + v.def.radius;
      const dy = v.y + v.def.height * 0.5 - cy;
      if (d > reach || (dy < 0 ? -dy : dy) > Math.max(GROUND_REACH, w.splashRadius * 0.6)) continue;
      const falloff = 1 - 0.5 * (d / reach);
      const nx = d > 1e-6 ? vx / d : u.fx;
      const nz = d > 1e-6 ? vz / d : u.fz;
      this.damage(v, w.damage * charge * falloff, w, nx, nz, falloff);
    }
  }

  /** Summons a whirlwind just in front of the target, heading into it. */
  private vortex(u: SimUnit, w: WeaponDef): void {
    const r = Math.max(0.5, w.splashRadius);
    const lim = this.terrain.half - EDGE_MARGIN;
    const t = this.units[u.actionTargetId];
    let x = u.x + u.fx * (u.def.radius + r * 0.6);
    let z = u.z + u.fz * (u.def.radius + r * 0.6);
    if (t && t.alive && t.side !== u.side) {
      const dx = t.x - u.x;
      const dz = t.z - u.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const back = Math.min(d * 0.5, r * 1.5);
      if (d > 1e-6) {
        x = t.x - (dx / d) * back;
        z = t.z - (dz / d) * back;
      }
    }
    const zone = new SimZone(this.nextZoneId++, u.side, u.id, w, clamp(x, -lim, lim), clamp(z, -lim, lim), u.actionTargetId);
    zone.vx = u.fx * w.zoneSpeed;
    zone.vz = u.fz * w.zoneSpeed;
    this.zones.push(zone);
  }

  private updateZones(): void {
    if (this.zones.length === 0) return;
    const g = this.content.settings.gravity;
    const lim = this.terrain.half - EDGE_MARGIN;
    for (const zn of this.zones) {
      const w = zn.weapon;
      const r = zn.radius;
      zn.px = zn.x;
      zn.pz = zn.z;
      zn.age += SIM_DT;
      if (zn.age >= Math.max(SIM_DT, w.duration)) {
        zn.alive = false;
        this.releaseZone(zn);
        continue;
      }
      // Wander toward the nearest enemy.
      let t = this.units[zn.targetId];
      if (!t || !t.alive || t.side === zn.side || (this.tick + zn.id) % 15 === 0) {
        zn.targetId = this.nearestEnemy(zn.x, zn.z, zn.side, 30);
        t = this.units[zn.targetId];
      }
      if (t) {
        const dx = t.x - zn.x;
        const dz = t.z - zn.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.5) {
          zn.vx += ((dx / d) * w.zoneSpeed - zn.vx) * 0.04;
          zn.vz += ((dz / d) * w.zoneSpeed - zn.vz) * 0.04;
        }
      }
      zn.x = clamp(zn.x + zn.vx * SIM_DT, -lim, lim);
      zn.z = clamp(zn.z + zn.vz * SIM_DT, -lim, lim);

      const near = this.near(zn.x, zn.z, r + 4, this.scratch2);
      for (const v of near) {
        if (!v.alive || v.side === zn.side) continue;
        const dx = v.x - zn.x;
        const dz = v.z - zn.z;
        const reach = r + v.def.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 > reach * reach) continue;
        const ground = this.terrain.height(v.x, v.z);
        const height = v.y - ground;
        if (v.flying && height > r * 2.5) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        this.dot(v, w.damage * SIM_DT, w, nx, nz);
        if (!v.alive || v.flying) continue;
        const res = (1 - v.def.knockbackResist) / Math.sqrt(v.def.mass);
        if (res <= 0.02) continue;
        // Orbit: tangential swirl plus a pull toward a ring inside the funnel.
        const swirl = w.pull * res;
        const inward = w.pull * res * 0.6 * ((d - r * 0.35) / r);
        const wantX = -nz * swirl - nx * inward;
        const wantZ = nx * swirl - nz * inward;
        v.kx += (wantX - v.kx) * 0.12;
        v.kz += (wantZ - v.kz) * 0.12;
        if (w.lift <= 0) continue;
        if (!v.airborne) {
          if (d < r * 0.9) this.applyKnock(v, 0, 0, 0, w.lift);
        } else {
          // Ride up the funnel (hovering around a ceiling) instead of falling straight back.
          const ceiling = 1.5 + w.lift * 0.5 * res;
          v.vy += (height < ceiling ? g * 1.25 : g * 0.2) * SIM_DT;
          if (v.vy > w.lift * res * 0.6) v.vy = w.lift * res * 0.6;
        }
      }
    }
    this.zones = this.zones.filter((zn) => zn.alive);
  }

  /** The whirlwind collapses and flings whoever it still holds. */
  private releaseZone(zn: SimZone): void {
    const w = zn.weapon;
    const r = zn.radius;
    this.events.push({ type: 'zone-end', zoneId: zn.id, weaponId: w.id, x: zn.x, y: this.terrain.height(zn.x, zn.z), z: zn.z, radius: r });
    const near = this.near(zn.x, zn.z, r + 4, this.scratch2);
    for (const v of near) {
      if (!v.alive || v.side === zn.side || v.flying) continue;
      const dx = v.x - zn.x;
      const dz = v.z - zn.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > r + v.def.radius + 1) continue;
      this.applyKnock(v, d > 1e-6 ? dx / d : 1, d > 1e-6 ? dz / d : 0, w.knockback, w.knockUp);
    }
  }

  private nearestEnemy(x: number, z: number, side: Side, maxDist: number): number {
    let best = -1;
    let bestD = maxDist * maxDist;
    for (const v of this.units) {
      if (!v.alive || v.side === side || v.flying || v.structure) continue;
      const d = (v.x - x) * (v.x - x) + (v.z - z) * (v.z - z);
      if (d < bestD) {
        bestD = d;
        best = v.id;
      }
    }
    return best;
  }

  private inRangeLoose(u: SimUnit, w: WeaponDef, t: SimUnit): boolean {
    const dx = t.x - u.x;
    const dz = t.z - u.z;
    const reach = (w.range + u.def.radius + t.def.radius) * 1.2;
    return dx * dx + dz * dz <= reach * reach && this.verticalReach(u, t);
  }

  private chargeMultiplier(u: SimUnit): number {
    const bonus = u.def.chargeBonus;
    if (bonus <= 1 || u.def.speed <= 0) return 1;
    const ratio = u.chargeSpeed / u.def.speed;
    if (ratio <= 0.6) return 1;
    return 1 + (bonus - 1) * Math.min(1, (ratio - 0.6) / 0.4);
  }

  private meleeHit(u: SimUnit, w: WeaponDef, v: SimUnit, amount: number): void {
    let nx = v.x - u.x;
    let nz = v.z - u.z;
    const len = Math.sqrt(nx * nx + nz * nz);
    if (len > 1e-6) {
      nx /= len;
      nz /= len;
    } else {
      nx = u.fx;
      nz = u.fz;
    }
    // Shields block some frontal melee too (half as often as arrows).
    if (v.def.blockChance > 0 && -(nx * v.fx + nz * v.fz) > 0.3 && this.rng.next() < v.def.blockChance * 0.5) {
      this.events.push({ type: 'hit', x: v.x, y: v.y + v.def.height * 0.6, z: v.z, dx: nx, dz: nz, weaponId: w.id, targetId: v.id, blocked: true, damage: 0 });
      this.applyKnock(v, nx, nz, w.knockback * 0.3, 0);
      return;
    }
    this.damage(v, amount, w, nx, nz, 1);
    this.aggro(v, u);
  }

  private aggro(victim: SimUnit, attacker: SimUnit): void {
    if (!victim.alive || victim.weapon.attack !== 'melee' || victim.side === attacker.side) return;
    const cur = this.units[victim.targetId];
    if (!cur || !cur.alive) {
      victim.targetId = attacker.id;
      return;
    }
    const d1 = (cur.x - victim.x) * (cur.x - victim.x) + (cur.z - victim.z) * (cur.z - victim.z);
    const d2 = (attacker.x - victim.x) * (attacker.x - victim.x) + (attacker.z - victim.z) * (attacker.z - victim.z);
    if (d2 * 2.25 < d1 && (!attacker.flying || victim.flying)) victim.targetId = attacker.id;
  }

  private multiplier(type: WeaponDef['damageType'], v: SimUnit): number {
    return this.content.settings.damageMatrix[type][v.def.armorClass];
  }

  private damage(v: SimUnit, amount: number, w: WeaponDef, nx: number, nz: number, falloff: number): void {
    if (!v.alive) return;
    const dmg = amount * this.multiplier(w.damageType, v);
    v.hp -= dmg;
    this.events.push({ type: 'hit', x: v.x, y: v.y + v.def.height * 0.6, z: v.z, dx: nx, dz: nz, weaponId: w.id, targetId: v.id, blocked: false, damage: dmg });
    if (v.hp <= 0) {
      this.kill(v, nx, nz, w.knockback * falloff, w.knockUp * falloff);
      return;
    }
    this.applyStatus(v, w);
    this.applyKnock(v, nx, nz, w.knockback * falloff, w.knockUp * falloff);
  }

  /** Continuous damage (whirlwinds): hp every tick, a `hit` event now and then. */
  private dot(v: SimUnit, amount: number, w: WeaponDef, nx: number, nz: number): void {
    const dmg = amount * this.multiplier(w.damageType, v);
    v.hp -= dmg;
    if ((this.tick + v.id) % DOT_EVENT_TICKS === 0) {
      this.events.push({ type: 'hit', x: v.x, y: v.y + v.def.height * 0.6, z: v.z, dx: nx, dz: nz, weaponId: w.id, targetId: v.id, blocked: false, damage: dmg * DOT_EVENT_TICKS });
    }
    if (v.hp <= 0) this.kill(v, nx, nz, w.knockback, w.knockUp + 2);
    else this.applyStatus(v, w);
  }

  private applyKnock(v: SimUnit, nx: number, nz: number, force: number, up: number): void {
    if (!v.alive || (force <= 0 && up <= 0)) return;
    const res = 1 - v.def.knockbackResist;
    const imp = (force * res) / v.def.mass;
    v.kx += nx * imp;
    v.kz += nz * imp;
    if (up > 0 && !v.flying && !v.structure) {
      const vy = (up * res) / Math.sqrt(v.def.mass);
      if (vy > 2) {
        v.vy = v.airborne ? Math.max(v.vy, vy) : vy;
        v.airborne = true;
        v.windupLeft = -1;
        v.channelLeft = 0;
        v.action = null;
      }
    }
    if (imp > 4) v.stun = Math.max(v.stun, Math.min(1.2, imp * 0.05));
  }

  private kill(v: SimUnit, nx: number, nz: number, force: number, up: number): void {
    if (!v.alive) return;
    v.alive = false;
    v.hp = 0;
    v.deathTick = this.tick;
    v.windupLeft = -1;
    v.channelLeft = 0;
    v.action = null;
    v.burnLeft = 0;
    const res = 1 - v.def.knockbackResist;
    const f = (force * res) / v.def.mass + 1.5;
    this.events.push({ type: 'death', unitId: v.id, dx: nx, dy: 0.4 + (up * res) / Math.sqrt(v.def.mass) / 6, dz: nz, force: f });
  }

  // ------------------------------------------------------------------ projectiles

  private launch(u: SimUnit, a: SimAbility, t: SimUnit): void {
    const def = a.projectile;
    if (!def) return;
    const w = a.def;
    const ox = u.x + u.fx * u.def.radius * 0.8;
    const oz = u.z + u.fz * u.def.radius * 0.8;
    const oy = u.y + (u.flying ? 0 : u.def.height * 0.8);
    const speed = w.projectileSpeed;
    let tx = t.x;
    let tz = t.z;
    const ty = t.y + t.def.height * 0.5;
    // One lead iteration against the target's current velocity.
    let d = Math.sqrt((tx - ox) * (tx - ox) + (tz - oz) * (tz - oz));
    let T = Math.max(0.15, d / speed);
    tx += (t.vx + t.kx) * T;
    tz += (t.vz + t.kz) * T;
    if (w.spread > 0) {
      const [sx, sz] = this.rng.disk();
      const s = (w.spread * d) / 10;
      tx += sx * s;
      tz += sz * s;
    }
    d = Math.sqrt((tx - ox) * (tx - ox) + (tz - oz) * (tz - oz));
    T = Math.max(0.15, d / speed);
    const g = def.gravity;
    const vx = (tx - ox) / T;
    const vz = (tz - oz) / T;
    const vy = (ty - oy + 0.5 * g * T * T) / T;
    const p = new SimProjectile(this.nextProjectileId++, u.side, u.id, def, w, ox, oy, oz, vx, vy, vz, 1);
    this.projectiles.push(p);
    this.events.push({ type: 'launch', projectileId: p.id });
  }

  private updateProjectiles(): void {
    const near: SimUnit[] = [];
    const lim = this.terrain.half + 10;
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.age += SIM_DT;
      p.vy -= p.def.gravity * SIM_DT;
      const sx = p.vx * SIM_DT;
      const sy = p.vy * SIM_DT;
      const sz = p.vz * SIM_DT;
      const mx = p.x + sx * 0.5;
      const mz = p.z + sz * 0.5;
      const segLen = Math.sqrt(sx * sx + sy * sy + sz * sz);
      this.near(mx, mz, segLen * 0.5 + 4, near);
      let hit: SimUnit | null = null;
      let hitT = 2;
      const a = sx * sx + sy * sy + sz * sz;
      for (const v of near) {
        if (!v.alive || v.side === p.side) continue;
        const r = Math.max(v.def.radius, v.def.height * 0.5) * 0.9 + p.def.hitRadius;
        const fx = p.x - v.x;
        const fy = p.y - (v.y + v.def.height * 0.5);
        const fz = p.z - v.z;
        const c = fx * fx + fy * fy + fz * fz - r * r;
        let tHit: number;
        if (c <= 0) tHit = 0;
        else {
          const b = 2 * (fx * sx + fy * sy + fz * sz);
          const disc = b * b - 4 * a * c;
          if (disc < 0 || a < 1e-12) continue;
          tHit = (-b - Math.sqrt(disc)) / (2 * a);
          if (tHit < 0 || tHit > 1) continue;
        }
        if (tHit < hitT || (tHit === hitT && hit && v.id < hit.id)) {
          hitT = tHit;
          hit = v;
        }
      }
      const len = segLen || 1;
      const dx = sx / len;
      const dy = sy / len;
      const dz = sz / len;
      if (hit) {
        p.x += sx * hitT;
        p.y += sy * hitT;
        p.z += sz * hitT;
        p.alive = false;
        this.projectileHit(p, hit, dx, dy, dz);
        continue;
      }
      p.x += sx;
      p.y += sy;
      p.z += sz;
      const ground = this.terrain.height(p.x, p.z);
      if (p.y <= ground) {
        p.y = ground;
        p.alive = false;
        if (p.weapon.splashRadius > 0) this.blast(p.x, p.y, p.z, p.weapon, p.side, p.damageMul, false);
        this.events.push({ type: 'impact', defId: p.def.id, x: p.x, y: p.y, z: p.z, ground: true, dx, dy, dz, stuck: p.def.stick });
        continue;
      }
      if (p.age > p.def.lifetime || p.x < -lim || p.x > lim || p.z < -lim || p.z > lim) p.alive = false;
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  private projectileHit(p: SimProjectile, v: SimUnit, dx: number, dy: number, dz: number): void {
    const flat = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = dx / flat;
    const nz = dz / flat;
    this.events.push({ type: 'impact', defId: p.def.id, x: p.x, y: p.y, z: p.z, ground: false, dx, dy, dz, stuck: false });
    if (p.weapon.splashRadius > 0) {
      this.blast(p.x, p.y, p.z, p.weapon, p.side, p.damageMul, false);
      return;
    }
    if (v.def.blockChance > 0 && -(nx * v.fx + nz * v.fz) > 0.3 && this.rng.next() < v.def.blockChance) {
      this.events.push({ type: 'hit', x: p.x, y: p.y, z: p.z, dx: nx, dz: nz, weaponId: p.weapon.id, targetId: v.id, blocked: true, damage: 0 });
      return;
    }
    this.damage(v, p.weapon.damage * p.damageMul, p.weapon, nx, nz, 1);
    const owner = this.units[p.ownerId];
    if (owner) this.aggro(v, owner);
  }

  /** Area damage with falloff; `column` ignores height (strikes from the sky). */
  private blast(x: number, y: number, z: number, w: WeaponDef, side: Side, mul: number, column: boolean): void {
    const r = w.splashRadius;
    const near = this.near(x, z, r + 4, []);
    const ff = this.content.settings.friendlyFire;
    for (const v of near) {
      if (!v.alive || (!ff && v.side === side)) continue;
      const vx = v.x - x;
      const vy = column ? 0 : v.y + v.def.height * 0.5 - y;
      const vz = v.z - z;
      const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const reach = r + v.def.radius;
      if (d > reach) continue;
      const falloff = 1 - 0.6 * (d / reach);
      const flat = Math.sqrt(vx * vx + vz * vz);
      const nx = flat > 1e-6 ? vx / flat : 1;
      const nz = flat > 1e-6 ? vz / flat : 0;
      this.damage(v, w.damage * mul * falloff, w, nx, nz, falloff);
    }
  }

  // ------------------------------------------------------------------ end

  // ------------------------------------------------------------------ siege structures

  /** Wall cells lose a tier per blockHp of damage; a destroyed cell becomes rubble. */
  private updateWalls(): void {
    if (this.walls.size === 0) return;
    const tierHeight = this.content.settings.siege.tierHeight;
    for (const cell of this.walls.values()) {
      if (cell.tiers === 0) continue;
      const u = cell.unit;
      const tiers = u.alive ? Math.max(1, Math.ceil(u.hp / cell.blockHp - 1e-9)) : 0;
      if (tiers >= cell.tiers) continue;
      const lost = cell.tiers - tiers;
      cell.tiers = tiers;
      if (cell.kind === 'wall' && tiers > 0) (u.def as { height: number }).height = tiers * tierHeight;
      this.events.push({ type: 'wall-break', unitId: u.id, tiers, lost, x: u.x, y: cell.top, z: u.z, dx: -u.fx, dz: -u.fz });
    }
  }

  /** Barracks produce one unit per spawnInterval while fewer than spawnMax of theirs live. */
  private updateSpawns(): void {
    const count = this.units.length;
    for (let i = 0; i < count; i++) {
      const b = this.units[i];
      if (!b.alive || !b.def.spawnUnitId) continue;
      b.spawnLeft -= SIM_DT;
      if (b.spawnLeft > 0) continue;
      b.spawnLeft += b.def.spawnInterval;
      let alive = 0;
      for (const c of b.children) if (c.alive) alive++;
      const base = this.unitDefs.get(b.def.spawnUnitId);
      if (alive >= b.def.spawnMax || !base || base.structure !== 'none') continue;
      const lane = (b.children.length % 5) - 2;
      const x = b.x + b.fx * (b.radius + base.radius + 0.6);
      const z = b.z + lane * (base.radius * 2 + 0.3);
      const child = this.createUnit(b.side, base, x, z);
      if (!child) continue;
      child.fx = b.fx;
      child.fz = b.fz;
      b.children.push(child);
      this.events.push({ type: 'spawn', unitId: child.id, parentId: b.id });
    }
  }

  // ------------------------------------------------------------------ end

  private checkEnd(): void {
    const blue = this.aliveCount('blue');
    const red = this.aliveCount('red');
    const survivors = { blue, red };
    const defense = this.defense;
    if (defense) {
      const attack = defense === 'blue' ? 'red' : 'blue';
      let core = false;
      for (const u of this.units) if (u.alive && u.side === defense && u.def.structure === 'core') core = true;
      const alive = { blue, red };
      if (!core || alive[defense] === 0) this.result = { winner: attack, tick: this.tick, reason: core ? 'eliminated' : 'core', survivors };
      else if (alive[attack] === 0) this.result = { winner: defense, tick: this.tick, reason: 'eliminated', survivors };
      else if (this.tick >= this.timeLimitTicks) this.result = { winner: defense, tick: this.tick, reason: 'timeout', survivors };
      return;
    }
    if (blue === 0 || red === 0) {
      this.result = { winner: blue > 0 ? 'blue' : red > 0 ? 'red' : 'draw', tick: this.tick, reason: 'eliminated', survivors };
      return;
    }
    if (this.tick >= this.timeLimitTicks) this.result = { winner: 'draw', tick: this.tick, reason: 'timeout', survivors };
  }
}

/** Ranged basic attacks hold position at range instead of walking into melee. */
function isRanged(w: WeaponDef): boolean {
  return w.attack === 'projectile' || w.attack === 'chain' || w.attack === 'strike' || w.attack === 'vortex';
}

/** How far around the target an area skill counts enemies for `minTargets`. */
function clusterRadius(w: WeaponDef): number {
  if (w.attack === 'chain') return w.chainRange;
  if (w.splashRadius > 0) return w.splashRadius;
  if (w.attack === 'breath') return Math.max(2, w.range * 0.4);
  return Math.max(2, w.range);
}

function cellKey(cx: number, cz: number): number {
  return (cx + 4096) * 8192 + (cz + 4096);
}
