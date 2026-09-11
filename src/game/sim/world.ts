// Deterministic fixed-step battle simulation.
//
// Rules for determinism (online peers simulate independently from the same seed):
// only + - * / Math.sqrt Math.floor Math.round on doubles, the seeded Rng, fixed
// iteration order (spawn order), no Math.random / trig / Date. Cosmetics (ragdolls,
// particles, animation) live in the renderer and never feed back into this file.
import type { ContentBundle, MapDef, ProjectileDef, UnitDef, WeaponDef } from '@/shared/schema';
import type { Armies, Side } from './army';
import { Rng, clamp, dcos, fnv1a } from './rng';
import { EDGE_MARGIN, type Obstacle, Terrain } from './terrain';

export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;

const CELL = 3;
const RETARGET_TICKS = 10;
const TURN_RATE = 0.3;
const ACCEL = 0.25;
const GROUND_REACH = 2.6;
const WATER_SLOW = 0.55;
const DEG = 0.017453292519943295;

export type SimEvent =
  | { type: 'hit'; x: number; y: number; z: number; dx: number; dz: number; weaponId: string; targetId: number; blocked: boolean; damage: number }
  | { type: 'death'; unitId: number; dx: number; dy: number; dz: number; force: number }
  | { type: 'attack'; unitId: number; weaponId: string; x: number; y: number; z: number; dx: number; dy: number; dz: number }
  | { type: 'launch'; projectileId: number }
  | { type: 'impact'; defId: string; x: number; y: number; z: number; ground: boolean; dx: number; dy: number; dz: number; stuck: boolean }
  | { type: 'heal'; x: number; y: number; z: number; targetId: number; weaponId: string }
  | { type: 'land'; unitId: number; x: number; y: number; z: number };

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
  cooldown = 0;
  windupLeft = -1;
  lastAttackTick = -1000;
  chargeSpeed = 0;
  stun = 0;
  airborne = false;
  flyHeight: number;
  deathTick = -1;
  readonly cosHalfArc: number;

  constructor(
    readonly id: number,
    readonly side: Side,
    readonly def: UnitDef,
    readonly weapon: WeaponDef,
    readonly projectile: ProjectileDef | null,
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
    this.cosHalfArc = dcos(weapon.cleaveArc * 0.5 * DEG);
    // Stagger first attacks so a line does not swing in perfect unison.
    this.cooldown = (id % 7) * 0.05;
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

export interface BattleResult {
  winner: Side | 'draw';
  tick: number;
  reason: 'eliminated' | 'timeout';
  survivors: Record<Side, number>;
}

type SimContent = Pick<ContentBundle, 'units' | 'weapons' | 'projectiles' | 'settings'>;

export class BattleSim {
  readonly units: SimUnit[] = [];
  projectiles: SimProjectile[] = [];
  readonly events: SimEvent[] = [];
  tick = 0;
  result: BattleResult | null = null;

  private readonly rng: Rng;
  private readonly grid = new Map<number, SimUnit[]>();
  private readonly obstacleGrid = new Map<number, Obstacle[]>();
  private nextProjectileId = 1;
  private readonly timeLimitTicks: number;

  constructor(
    private readonly content: SimContent,
    readonly map: MapDef,
    readonly terrain: Terrain,
    armies: Armies,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    this.timeLimitTicks = Math.round(content.settings.battleTimeLimit * SIM_HZ);
    const units = new Map(content.units.map((u) => [u.id, u]));
    const weapons = new Map(content.weapons.map((w) => [w.id, w]));
    const projectiles = new Map(content.projectiles.map((p) => [p.id, p]));
    for (const side of ['blue', 'red'] as const) {
      for (const p of armies[side]) {
        const def = units.get(p.unitId);
        const weapon = def && weapons.get(def.weaponId);
        if (!def || !weapon) continue;
        const projectile = weapon.projectileId ? projectiles.get(weapon.projectileId) ?? null : null;
        const u = new SimUnit(this.units.length, side, def, weapon, projectile, p.x, p.z, terrain.height(p.x, p.z));
        this.units.push(u);
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

  unit(id: number): SimUnit | undefined {
    return this.units[id];
  }

  aliveCount(side: Side): number {
    let n = 0;
    for (const u of this.units) if (u.alive && u.side === side) n++;
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
    for (const u of this.units) if (u.alive) this.updateTarget(u);
    for (const u of this.units) if (u.alive) this.steer(u);
    for (const u of this.units) if (u.alive) this.integrate(u);
    this.resolveCollisions();
    for (const u of this.units) if (u.alive) this.updateAttack(u);
    this.updateProjectiles();
    if (!this.result) this.checkEnd();
  }

  checksum(): number {
    const v: number[] = [this.tick];
    for (const u of this.units) {
      v.push(u.alive ? 1 : 0, Math.round(u.x * 1000), Math.round(u.y * 1000), Math.round(u.z * 1000), Math.round(u.hp * 100));
    }
    for (const p of this.projectiles) v.push(p.id, Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000));
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
    let best = -1;
    let bestD = Infinity;
    let bestAny = -1;
    let bestAnyD = Infinity;
    for (const v of this.units) {
      if (!v.alive || v.side === u.side) continue;
      const dx = v.x - u.x;
      const dz = v.z - u.z;
      const d = dx * dx + dz * dz;
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
    return best >= 0 ? best : bestAny;
  }

  private pickHealTarget(u: SimUnit): number {
    let best = -1;
    let bestScore = Infinity;
    let follow = -1;
    let followD = Infinity;
    for (const v of this.units) {
      if (!v.alive || v.side !== u.side || v === u) continue;
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
    const t = this.units[u.targetId];
    if (u.stun > 0 || u.airborne) {
      u.vx *= 0.8;
      u.vz *= 0.8;
      return;
    }
    if (t && t.alive) {
      const dx = t.x - u.x;
      const dz = t.z - u.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 1e-6) {
        const nx = dx / dist;
        const nz = dz / dist;
        let want = 0;
        const w = u.weapon;
        if (w.attack === 'heal') {
          const keep = t.side === u.side && t.hp < t.def.hp ? w.range * 0.7 : 4 + u.radius + t.radius;
          if (dist > keep) want = 1;
        } else if (w.attack === 'projectile') {
          if (dist > w.range * 0.95) want = 1;
          else if (dist < w.minRange) want = -1;
        } else {
          const reach = w.range + u.radius + t.radius;
          if (dist > reach * 0.9) want = 1;
        }
        const water = !u.flying && this.terrain.inWater(u.x, u.z) ? WATER_SLOW : 1;
        const sp = u.def.speed * water * want;
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
    if (u.airborne) {
      u.x += u.kx * SIM_DT;
      u.z += u.kz * SIM_DT;
      u.y += u.vy * SIM_DT;
      u.vy -= g * SIM_DT;
      u.kx *= 0.995;
      u.kz *= 0.995;
      this.clampBounds(u);
      const ground = this.terrain.height(u.x, u.z);
      if (u.y <= ground) {
        u.y = ground;
        u.airborne = false;
        u.stun = Math.max(u.stun, 0.5 + Math.min(1.5, -u.vy * 0.1));
        u.vy = 0;
        u.kx *= 0.4;
        u.kz *= 0.4;
        this.events.push({ type: 'land', unitId: u.id, x: u.x, y: u.y, z: u.z });
      }
      return;
    }
    u.x += (u.vx + u.kx) * SIM_DT;
    u.z += (u.vz + u.kz) * SIM_DT;
    u.kx *= 0.82;
    u.kz *= 0.82;
    if (u.stun > 0) u.stun -= SIM_DT;
  }

  private clampBounds(u: SimUnit): void {
    const lim = this.terrain.half - EDGE_MARGIN * 0.5;
    u.x = clamp(u.x, -lim, lim);
    u.z = clamp(u.z, -lim, lim);
  }

  private scratch: SimUnit[] = [];

  private resolveCollisions(): void {
    const near = this.scratch;
    for (const u of this.units) {
      if (!u.alive) continue;
      this.near(u.x, u.z, u.radius + 6, near);
      for (const v of near) {
        if (v.id <= u.id || !v.alive) continue;
        if (u.flying !== v.flying || u.airborne || v.airborne) continue;
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
        const pu = overlap * (v.mass / total) * 0.8;
        const pv = overlap * (u.mass / total) * 0.8;
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
    for (const u of this.units) {
      if (!u.alive) continue;
      if (!u.flying) this.pushOutOfObstacles(u);
      this.clampBounds(u);
      if (u.airborne) continue;
      const ground = this.terrain.height(u.x, u.z);
      u.y = u.flying ? ground + u.flyHeight : ground;
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

  // ------------------------------------------------------------------ combat

  private updateAttack(u: SimUnit): void {
    u.cooldown -= SIM_DT;
    if (u.stun > 0 || u.airborne) {
      u.windupLeft = -1;
      return;
    }
    const t = this.units[u.targetId];
    if (u.windupLeft >= 0) {
      u.windupLeft -= SIM_DT;
      if (u.windupLeft <= 0) this.execute(u, t);
      return;
    }
    if (!t || !t.alive || u.cooldown > 0 || !this.inRange(u, t)) return;
    if (u.weapon.attack === 'heal' && (t.side !== u.side || t.hp >= t.def.hp)) return;
    u.chargeSpeed = u.speed();
    if (u.weapon.windup <= 0) this.execute(u, t);
    else u.windupLeft = u.weapon.windup;
  }

  private inRange(u: SimUnit, t: SimUnit): boolean {
    const w = u.weapon;
    const dx = t.x - u.x;
    const dz = t.z - u.z;
    const d2 = dx * dx + dz * dz;
    switch (w.attack) {
      case 'projectile':
        return d2 <= w.range * w.range && d2 >= w.minRange * w.minRange;
      case 'heal':
        return d2 <= w.range * w.range;
      case 'breath': {
        const dy = t.y + t.def.height * 0.5 - u.y;
        const r = w.range + t.def.radius;
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

  private execute(u: SimUnit, t: SimUnit | undefined): void {
    const w = u.weapon;
    u.windupLeft = -1;
    u.cooldown = w.cooldown;
    u.lastAttackTick = this.tick;
    let dx = u.fx;
    let dy = 0;
    let dz = u.fz;
    if (t) {
      const tx = t.x - u.x;
      const ty = t.y + t.def.height * 0.5 - (u.y + u.def.height * 0.7);
      const tz = t.z - u.z;
      const len = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      dx = tx / len;
      dy = ty / len;
      dz = tz / len;
    }
    this.events.push({ type: 'attack', unitId: u.id, weaponId: w.id, x: u.x, y: u.y + u.def.height * 0.7, z: u.z, dx, dy, dz });

    if (w.attack === 'heal') {
      if (t && t.alive && t.side === u.side) {
        t.hp = Math.min(t.def.hp, t.hp + w.damage);
        this.events.push({ type: 'heal', x: t.x, y: t.y + t.def.height * 0.6, z: t.z, targetId: t.id, weaponId: w.id });
      }
      return;
    }
    if (w.attack === 'projectile') {
      if (t && t.alive) for (let i = 0; i < w.volley; i++) this.launch(u, t);
      return;
    }

    const charge = this.chargeMultiplier(u);
    const cone = w.attack === 'breath' || w.cleaveArc > 0;
    if (!cone) {
      if (t && t.alive && t.side !== u.side && this.inRangeLoose(u, t)) this.meleeHit(u, t, w.damage * charge);
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
        if (dot < u.cosHalfArc) continue;
        hits.push({ v, d: d3 });
      } else {
        if (d > w.range + u.def.radius + v.def.radius || !this.verticalReach(u, v)) continue;
        const dot = d > 1e-6 ? (vx * u.fx + vz * u.fz) / d : 1;
        if (dot < u.cosHalfArc) continue;
        hits.push({ v, d });
      }
    }
    hits.sort((a, b) => a.d - b.d || a.v.id - b.v.id);
    const n = Math.min(w.maxTargets, hits.length);
    for (let i = 0; i < n; i++) this.meleeHit(u, hits[i].v, w.damage * charge);
  }

  private inRangeLoose(u: SimUnit, t: SimUnit): boolean {
    const dx = t.x - u.x;
    const dz = t.z - u.z;
    const reach = (u.weapon.range + u.def.radius + t.def.radius) * 1.2;
    return dx * dx + dz * dz <= reach * reach && this.verticalReach(u, t);
  }

  private chargeMultiplier(u: SimUnit): number {
    const bonus = u.def.chargeBonus;
    if (bonus <= 1 || u.def.speed <= 0) return 1;
    const ratio = u.chargeSpeed / u.def.speed;
    if (ratio <= 0.6) return 1;
    return 1 + (bonus - 1) * Math.min(1, (ratio - 0.6) / 0.4);
  }

  private meleeHit(u: SimUnit, v: SimUnit, amount: number): void {
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
      this.events.push({ type: 'hit', x: v.x, y: v.y + v.def.height * 0.6, z: v.z, dx: nx, dz: nz, weaponId: u.weapon.id, targetId: v.id, blocked: true, damage: 0 });
      this.applyKnock(v, nx, nz, u.weapon.knockback * 0.3, 0);
      return;
    }
    this.damage(v, amount, u.weapon, nx, nz, 1);
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
    if (v.hp <= 0) this.kill(v, nx, nz, w.knockback * falloff, w.knockUp * falloff);
    else this.applyKnock(v, nx, nz, w.knockback * falloff, w.knockUp * falloff);
  }

  private applyKnock(v: SimUnit, nx: number, nz: number, force: number, up: number): void {
    if (!v.alive || (force <= 0 && up <= 0)) return;
    const res = 1 - v.def.knockbackResist;
    const imp = (force * res) / v.def.mass;
    v.kx += nx * imp;
    v.kz += nz * imp;
    if (up > 0 && !v.flying) {
      const vy = (up * res) / Math.sqrt(v.def.mass);
      if (vy > 2) {
        v.vy = v.airborne ? Math.max(v.vy, vy) : vy;
        v.airborne = true;
        v.windupLeft = -1;
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
    const res = 1 - v.def.knockbackResist;
    const f = (force * res) / v.def.mass + 1.5;
    this.events.push({ type: 'death', unitId: v.id, dx: nx, dy: 0.4 + (up * res) / Math.sqrt(v.def.mass) / 6, dz: nz, force: f });
  }

  // ------------------------------------------------------------------ projectiles

  private launch(u: SimUnit, t: SimUnit): void {
    const def = u.projectile;
    if (!def) return;
    const w = u.weapon;
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
        if (p.weapon.splashRadius > 0) this.splash(p);
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
      this.splash(p);
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

  private splash(p: SimProjectile): void {
    const w = p.weapon;
    const r = w.splashRadius;
    const near = this.near(p.x, p.z, r + 4, []);
    const ff = this.content.settings.friendlyFire;
    for (const v of near) {
      if (!v.alive || (!ff && v.side === p.side)) continue;
      const vx = v.x - p.x;
      const vy = v.y + v.def.height * 0.5 - p.y;
      const vz = v.z - p.z;
      const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const reach = r + v.def.radius;
      if (d > reach) continue;
      const falloff = 1 - 0.6 * (d / reach);
      const flat = Math.sqrt(vx * vx + vz * vz);
      const nx = flat > 1e-6 ? vx / flat : 1;
      const nz = flat > 1e-6 ? vz / flat : 0;
      this.damage(v, w.damage * p.damageMul * falloff, w, nx, nz, falloff);
    }
  }

  // ------------------------------------------------------------------ end

  private checkEnd(): void {
    const blue = this.aliveCount('blue');
    const red = this.aliveCount('red');
    const survivors = { blue, red };
    if (blue === 0 || red === 0) {
      this.result = { winner: blue > 0 ? 'blue' : red > 0 ? 'red' : 'draw', tick: this.tick, reason: 'eliminated', survivors };
      return;
    }
    if (this.tick >= this.timeLimitTicks) {
      let vb = 0;
      let vr = 0;
      for (const u of this.units) {
        if (!u.alive) continue;
        const value = u.def.cost * (u.hp / u.def.hp);
        if (u.side === 'blue') vb += value;
        else vr += value;
      }
      const winner = Math.round(vb) === Math.round(vr) ? 'draw' : vb > vr ? 'blue' : 'red';
      this.result = { winner, tick: this.tick, reason: 'timeout', survivors };
    }
  }
}

function cellKey(cx: number, cz: number): number {
  return (cx + 4096) * 8192 + (cz + 4096);
}
