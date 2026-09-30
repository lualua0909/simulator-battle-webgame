// Skill effects: lightning bolts, telegraph circles, shockwaves, scorch marks, falling meteors,
// whirlwinds, cast glows, burning units, light flashes and camera shake; flame jets licking the
// ground, fire blasts, bite marks and earthquakes (ground cracks, rocks hopping, rumble).
// Driven by sim events plus read-only sim state; purely cosmetic (never feeds the sim).
import * as THREE from 'three';
import type { ConfigBundle, ParticleDef, ProjectileDef, WeaponDef } from '@/shared/schema';
import { bakeModel, mergeTemplate } from '../models/bake';
import { createProjectileModel } from '../models/projectiles';
import type { Terrain } from '../sim/terrain';
import type { BattleSim, SimEvent } from '../sim/world';
import type { DebrisBurst } from './debris';
import { FireWhirlKit } from './fireWhirl';
import { WindWhirlKit } from './windWhirl';
import { GLOW_LAYER } from './glow';
import { commitInstances } from './instancing';
import type { ParticleSystem } from './particles';

export interface EffectHost {
  readonly particles: ParticleSystem;
  /** Where a unit's spells leave from (staff orb, muzzle, hand, mouth). */
  emitPoint(unitId: number, out: THREE.Vector3): boolean;
  /** Interpolated chest position of a unit. */
  chest(unitId: number, out: THREE.Vector3): boolean;
  /** Shake the camera by `amount` (0..1) for a blast at (x, z). */
  shake(amount: number, x: number, z: number): void;
  /** Keep the camera rumbling for `seconds` (earthquake) around a blast at (x, z). */
  rumble(amount: number, seconds: number, x: number, z: number): void;
  /** A unit's body size: x = radius, y = height. */
  unitSize(unitId: number, out: THREE.Vector2): boolean;
  /** Throw cosmetic rocks that tumble and bounce on the terrain. */
  debris(burst: DebrisBurst): void;
}

// ---------------------------------------------------------------- lightning

const BOLT_LEVELS = 4; // 2^4 = 16 segments on the main channel
const FORK_LEVELS = 3;
const SEGMENT_CAP = 3000;

interface Bolt {
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** Unit the bolt leaves from (-1 = fixed point `a`); `fromChest` = its chest instead of its hands. */
  fromUnit: number;
  fromChest: boolean;
  toUnit: number;
  age: number;
  life: number;
  color: THREE.Color;
  width: number;
  rough: number;
  sky: boolean;
  /** Forks in use (`fork` may hold more: bolts are pooled). */
  forks: number;
  flickerAt: number;
  pts: THREE.Vector3[];
  fork: THREE.Vector3[][];
}

// ---------------------------------------------------------------- ground decals

const RING_SEG = 96;
/** Ring cross-section: inner, core and outer row brightness. Additive black is invisible, so glowing rings get a thin bright core that fades out. */
const RING_PROFILE: Record<RingKind, readonly [number, number, number]> = {
  telegraph: [0, 1, 0.15],
  fill: [0.1, 0.35, 1],
  shock: [0, 1, 0],
  halo: [0, 1, 0.1],
  scorch: [1, 1, 1],
};
type RingKind = 'telegraph' | 'fill' | 'shock' | 'scorch' | 'halo';

interface Ring {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  kind: RingKind;
  x: number;
  z: number;
  radius: number;
  age: number;
  life: number;
  color: THREE.Color;
  edge: Float32Array;
  active: boolean;
  /** Static rings (telegraph, scorch, halo) only rebuild their vertices once. */
  built: boolean;
}

interface Flash {
  light: THREE.PointLight;
  age: number;
  life: number;
  peak: number;
}

interface Meteor {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  age: number;
  life: number;
  trail: ParticleDef | null;
  trailAcc: number;
}

interface Whirl {
  group: THREE.Group;
  radius: number;
  age: number;
  fade: number;
  seen: number;
  dust: ParticleDef | null;
  dustAcc: number;
  /** Fire tornado: flame shells, a glowing scorch disc and flung embers. */
  fire: { kit: FireWhirlKit; spin: THREE.Mesh[]; phase: number; flameAcc: number; lightAt: number } | null;
  /** Wind tornado: streaked gust shells, dust ring and orbiting leaves. */
  wind: { kit: WindWhirlKit; spin: THREE.Mesh[]; ring: THREE.Mesh; debris: THREE.Mesh; phase: number } | null;
}

// ---------------------------------------------------------------- ground cracks

const CRACK_CAP = 1600;
/** Per crack segment: ax ay az bx by bz width reveal-time. */
const CRACK_STRIDE = 8;
/** Seconds a segment takes to split open once the crack front reaches it. */
const CRACK_OPEN = 0.07;

interface Crack {
  segs: Float32Array;
  age: number;
  life: number;
  /** Molten (meteor crater): glows, then cools to charred. */
  hot: boolean;
}

/** Teeth snapping shut on a bitten unit, or claw rakes slashed across a mauled one. */
interface Jaw {
  claw: boolean;
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  size: number;
  age: number;
  life: number;
}

/** A particle burst waiting for its moment (a flame reaching the ground, smoke after a blast). */
interface Later {
  at: number;
  def: ParticleDef;
  x: number;
  y: number;
  z: number;
  count: number;
  size: number;
  up: boolean;
}

const ROCKS = ['#8a7d6a', '#6e6254', '#a09280', '#5a4f44', '#7b6a52'] as const;
const CHARRED = ['#3a2c22', '#2a211b', '#5a3a24', '#6e6254'] as const;
const UP = { x: 0, y: 1, z: 0 };
const zAxis = new THREE.Vector3(0, 0, 1);

export class EffectRenderer {
  readonly group = new THREE.Group();
  private terrain: Terrain | null = null;
  private readonly weapons: Map<string, WeaponDef>;
  private readonly particleDefs: Map<string, ParticleDef>;
  private readonly projectileDefs: Map<string, ProjectileDef>;
  private burnDef: ParticleDef | null;

  private readonly bolts: Bolt[] = [];
  /** Finished bolts reused by the next ones (casters crackle many short bolts per second). */
  private readonly boltPool: Bolt[] = [];
  private readonly core: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedMesh;
  /** Instance colour arrays: [core, glow]. */
  private readonly boltColors: Float32Array[];
  private readonly rings: Ring[] = [];
  private readonly flashPool: Flash[] = [];
  /** The pooled lights in the scene (quality tier); flashes are dropped when there are none. */
  private flashes: Flash[] = [];
  private flashNext = 0;
  private readonly meteors: Meteor[] = [];
  private readonly meteorGeo = new Map<string, THREE.BufferGeometry>();
  private readonly meteorMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, emissive: '#ff5a10', emissiveIntensity: 0.35 });
  private readonly whirls = new Map<number, Whirl>();
  private readonly fireKits = new Map<string, FireWhirlKit>();
  private readonly windKits = new Map<string, WindWhirlKit>();
  /** Copies of flame / ember particles flung along the fire whirl's spin instead of straight up. */
  private readonly swirlDefs = new Map<string, ParticleDef>();
  private frame = 0;
  private time = 0;
  private readonly cracks: Crack[] = [];
  private readonly crackMesh: THREE.InstancedMesh;
  private readonly jaws: Jaw[] = [];
  private readonly jawPts = Array.from({ length: 9 }, () => new THREE.Vector3());
  private readonly size2 = new THREE.Vector2();
  /** Frame of the last bite shake: a cleaving bite hits many units at once but shakes once. */
  private biteFrame = -1;
  private readonly later: Later[] = [];
  /** Hotter, thinner copies of flame particles for the jet's white-hot core. */
  private readonly coreDefs = new Map<string, ParticleDef>();
  private readonly dir = { x: 0, y: 0, z: 0 };

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly c1 = new THREE.Color();

  constructor(bundle: ConfigBundle) {
    this.group.name = 'effects';
    this.weapons = new Map(bundle.weapons.map((w) => [w.id, w]));
    this.particleDefs = new Map(bundle.particles.map((p) => [p.id, p]));
    this.projectileDefs = new Map(bundle.projectiles.map((p) => [p.id, p]));
    this.burnDef = bundle.settings.burnParticleId ? this.particleDefs.get(bundle.settings.burnParticleId) ?? null : null;

    const segment = new THREE.BoxGeometry(1, 1, 1);
    // Solid core so the bolt reads on bright grass; additive halo carries the colour.
    this.core = new THREE.InstancedMesh(segment, new THREE.MeshBasicMaterial({ toneMapped: false }), SEGMENT_CAP);
    this.glow = new THREE.InstancedMesh(segment, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.33, depthWrite: false, toneMapped: false }), SEGMENT_CAP);
    for (const mesh of [this.glow, this.core]) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SEGMENT_CAP * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
    }
    // Only the coloured halo feeds the bloom: a white core would bloom white and lose the skill's hue.
    this.glow.layers.enable(GLOW_LAYER);
    this.boltColors = [this.core.instanceColor!.array as Float32Array, this.glow.instanceColor!.array as Float32Array];
    this.crackMesh = new THREE.InstancedMesh(
      segment,
      new THREE.MeshBasicMaterial({ toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      CRACK_CAP,
    );
    this.crackMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CRACK_CAP * 3), 3);
    this.crackMesh.count = 0;
    this.crackMesh.frustumCulled = false;
    this.crackMesh.renderOrder = 1;
    this.group.add(this.crackMesh);
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight('#ffffff', 0, 34, 1.6);
      light.visible = true;
      this.flashPool.push({ light, age: 1, life: 1, peak: 0 });
    }
    this.setFlashLights(this.flashPool.length);
  }

  /** How many flash lights stay in the scene. A fixed count: changing it recompiles lit materials once. */
  setFlashLights(n: number): void {
    const count = Math.max(0, Math.min(n, this.flashPool.length));
    if (count === this.flashes.length) return;
    for (const f of this.flashPool) {
      f.age = f.life;
      f.light.intensity = 0;
      this.group.remove(f.light);
    }
    this.flashes = this.flashPool.slice(0, count);
    for (const f of this.flashes) this.group.add(f.light);
    this.flashNext = 0;
  }

  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
  }

  // ------------------------------------------------------------------ events

  onEvent(e: SimEvent, host: EffectHost): void {
    switch (e.type) {
      case 'chain': {
        const w = this.weapons.get(e.weaponId);
        if (!w) return;
        e.targets.forEach((id, i) => {
          const from = i === 0 ? e.unitId : e.targets[i - 1];
          this.addBolt({ fromUnit: from, fromChest: i > 0, toUnit: id }, w.vfxColor, i === 0 ? 0.11 : 0.085, 0.34, false, host);
        });
        if (host.chest(e.targets[0], this.v1)) this.flash(this.v1, w.vfxColor, 5, 0.18);
        return;
      }
      case 'warn': {
        const w = this.weapons.get(e.weaponId);
        if (!w) return;
        const color = w.strikeVfx === 'meteor' ? '#ff5a1a' : w.vfxColor;
        this.addRing('telegraph', e.x, e.z, Math.max(0.8, e.radius), e.delay, color);
        this.addRing('fill', e.x, e.z, Math.max(0.8, e.radius), e.delay, color);
        if (w.strikeVfx === 'meteor') this.addMeteor(w, e, host);
        return;
      }
      case 'strike': {
        const w = this.weapons.get(e.weaponId);
        if (!w) return;
        this.strike(w, e.x, e.y, e.z, e.radius, host);
        return;
      }
      case 'nova': {
        const w = this.weapons.get(e.weaponId);
        if (!w) return;
        const heal = w.attack === 'heal';
        this.addRing('shock', e.x, e.z, e.radius, 0.45, w.vfxColor);
        this.addRing('shock', e.x, e.z, e.radius * 0.7, 0.6, w.vfxColor);
        this.ringBurst(w.areaParticleId, e.x, e.y + 0.2, e.z, e.radius, host);
        if (!heal) {
          this.addRing('scorch', e.x, e.z, e.radius * 0.3, 7, '#000000');
          host.shake(0.2 + e.radius * 0.03, e.x, e.z);
          if (w.damageType === 'blunt') this.quake(e.x, e.z, e.radius, host);
          else if (w.damageType === 'fire') this.fireBlast(e.x, e.y, e.z, e.radius, false, host);
        }
        this.v1.set(e.x, e.y + 1.2, e.z);
        this.flash(this.v1, w.vfxColor, heal ? 3 : 4, 0.3);
        return;
      }
      case 'zone-end': {
        const w = this.weapons.get(e.weaponId);
        if (!w) return;
        this.addRing('shock', e.x, e.z, e.radius * 1.4, 0.5, w.vfxColor);
        this.ringBurst(w.areaParticleId, e.x, e.y + 0.3, e.z, e.radius, host);
        host.shake(0.18, e.x, e.z);
        return;
      }
      case 'attack': {
        const w = this.weapons.get(e.weaponId);
        if (w?.attack === 'breath') {
          this.breath(w, e, host);
          return;
        }
        const p = w?.projectileId ? this.projectileDefs.get(w.projectileId) : undefined;
        if (w && (w.castStyle === 'gun' || p?.model === 'bullet') && host.emitPoint(e.unitId, this.v1)) this.flash(this.v1, '#ffc56a', 4, 0.07);
        return;
      }
      case 'hit': {
        const w = this.weapons.get(e.weaponId);
        // Claws, horns and jaws tear flesh (their hit particle is the red chunk).
        if (w && !e.blocked && e.damage > 0 && w.attack === 'melee' && w.hitParticleId === 'hit-chunk') this.tear(w, e, host);
        return;
      }
      case 'heal': {
        if (!host.unitSize(e.targetId, this.size2)) return;
        const r = Math.max(0.5, this.size2.x);
        this.addRing('halo', e.x, e.z, r * 1.3 + 0.3, 0.8, HEAL_HEX);
        this.v1.set(e.x, e.y, e.z);
        this.flash(this.v1, HEAL_HEX, 2, 0.35, true);
        return;
      }
      case 'impact': {
        // Fire pots, fireballs: a small fire blast where they burst (arrows only spark).
        const p = this.projectileDefs.get(e.defId);
        const blast = p?.impactParticleId ? this.particleDefs.get(p.impactParticleId) : undefined;
        if (!p || !blast || p.model === 'arrow' || !isFiery(blast, this.c1)) return;
        const r = 0.8 + p.scale * 0.9;
        this.v1.set(e.x, e.y + 0.8, e.z);
        this.flash(this.v1, '#ff8a3a', 5 + r * 2, 0.3, true);
        if (e.ground) this.addRing('scorch', e.x, e.z, r * 0.6, 6, '#000000');
        this.fireBlast(e.x, e.y, e.z, r, false, host);
        host.shake(0.05 + r * 0.03, e.x, e.z);
        return;
      }
      default:
        return;
    }
  }

  private strike(w: WeaponDef, x: number, y: number, z: number, radius: number, host: EffectHost): void {
    const meteor = w.strikeVfx === 'meteor';
    // The falling rock this blast belongs to has arrived.
    if (meteor) {
      let best = -1;
      let bestD = 9;
      this.meteors.forEach((m, i) => {
        const d = (m.to.x - x) ** 2 + (m.to.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) this.removeMeteor(best);
      const p = w.projectileId ? this.projectileDefs.get(w.projectileId) : undefined;
      const impact = p?.impactParticleId ? this.particleDefs.get(p.impactParticleId) : undefined;
      if (impact) host.particles.emit(impact, x, y + 0.6, z, undefined, Math.round(impact.count * (1 + radius * 0.08)), 1 + radius * 0.04);
    } else {
      this.v1.set(x + (Math.random() - 0.5) * 6, y + 36, z + (Math.random() - 0.5) * 6);
      this.v2.set(x, y, z);
      this.addBolt({ a: this.v1, b: this.v2 }, w.vfxColor, 0.24, 0.45, true, host);
      const spark = w.hitParticleId ? this.particleDefs.get(w.hitParticleId) : undefined;
      if (spark) host.particles.emit(spark, x, y + 0.3, z, undefined, spark.count * 2);
    }
    this.addRing('shock', x, z, radius * 1.25, meteor ? 0.55 : 0.4, meteor ? '#ff8a3a' : w.vfxColor);
    this.addRing('scorch', x, z, radius * (meteor ? 0.9 : 0.6), meteor ? 12 : 8, '#000000');
    this.ringBurst(w.areaParticleId, x, y + 0.2, z, radius, host);
    this.v1.set(x, y + 2.5, z);
    this.flash(this.v1, meteor ? '#ff8a3a' : w.vfxColor, meteor ? 14 : 12, meteor ? 0.45 : 0.3);
    host.shake(meteor ? 0.75 : 0.4, x, z);
    if (meteor) this.fireBlast(x, y, z, radius, true, host);
  }

  // ------------------------------------------------------------------ fire, bites, quakes

  /** One puff of a flame jet: white-hot core, then where it licks the ground, fire, embers, smoke and scorch. */
  private breath(w: WeaponDef, e: Extract<SimEvent, { type: 'attack' }>, host: EffectHost): void {
    const def = w.fireParticleId ? this.particleDefs.get(w.fireParticleId) : undefined;
    if (!def || !host.emitPoint(e.unitId, this.v1)) return;
    const o = this.v1;
    this.dir.x = e.dx;
    this.dir.y = e.dy;
    this.dir.z = e.dz;
    host.particles.emit(this.coreDef(def), o.x, o.y, o.z, this.dir, Math.max(2, Math.round(def.count * 0.4)));
    this.flash(o, w.damageType === 'fire' ? '#ff8a2a' : w.vfxColor, 2.2, 0.16, true);
    const terrain = this.terrain;
    if (!terrain) return;
    // March along the jet: the first point under the ground is where the flames splash.
    const reach = w.range * 0.95;
    let hit = -1;
    for (let i = 1; i <= 10; i++) {
      const d = (reach * i) / 10;
      const px = o.x + e.dx * d;
      const pz = o.z + e.dz * d;
      if (o.y + e.dy * d <= groundY(terrain, px, pz) + 0.25) {
        hit = d;
        break;
      }
    }
    const d = hit < 0 ? reach : hit;
    const x = o.x + e.dx * d;
    const z = o.z + e.dz * d;
    const y = hit < 0 ? o.y + e.dy * d : groundY(terrain, x, z) + 0.1;
    const at = this.time + d / 14;
    const smoke = this.particleDefs.get('smoke');
    if (smoke && Math.random() < (hit < 0 ? 0.3 : 0.45)) this.schedule(at + 0.1, smoke, x, y + 0.4, z, 1, 0.8, false);
    if (hit < 0) return;
    const lick = this.burnDef ?? def;
    this.schedule(at, lick, x, y, z, 2, 1.8, true);
    const ember = this.particleDefs.get('ember');
    if (ember && Math.random() < 0.6) this.schedule(at, ember, x, y, z, 2, 1, false);
    if (Math.random() < 0.2) this.addRing('scorch', x, z, 0.5 + Math.random() * 0.6, 5, '#000000');
  }

  private coreDef(def: ParticleDef): ParticleDef {
    let core = this.coreDefs.get(def.id);
    if (!core) {
      core = {
        ...def,
        id: `${def.id}:core`,
        colorStart: '#fff4d0',
        size: [def.size[0] * 0.45, def.size[1] * 0.4],
        speed: [def.speed[0] * 1.1, def.speed[1] * 1.1],
        lifetime: [def.lifetime[0] * 0.65, def.lifetime[1] * 0.65],
        spread: def.spread * 0.6,
      };
      this.coreDefs.set(def.id, core);
    }
    return core;
  }

  /** Fireball rising out of a blast, embers, then a smoke column; big ones also crack the ground molten and throw rocks. */
  private fireBlast(x: number, y: number, z: number, radius: number, big: boolean, host: EffectHost): void {
    const fire = this.particleDefs.get('fire');
    const ember = this.particleDefs.get('ember');
    const smoke = this.particleDefs.get('smoke');
    if (fire) host.particles.emit(fire, x, y + 0.3, z, UP, Math.round(6 + radius * 3), 0.9 + radius * 0.15);
    if (ember) host.particles.emit(ember, x, y + 0.4, z, undefined, Math.round(4 + radius * 4));
    if (smoke) this.schedule(this.time + 0.2, smoke, x, y + 0.6 + radius * 0.2, z, Math.round(4 + radius * 3), 0.9 + radius * 0.25, false);
    if (!big || !this.terrain) return;
    this.addCracks(x, z, radius * 1.1, true);
    host.debris({ x, y: y + 0.3, z, hx: radius * 0.25, hy: 0.2, hz: radius * 0.25, count: Math.round(8 + radius * 3), colors: CHARRED, force: 6 + radius * 0.6, size: [0.1, 0.38] });
    this.hopStones(x, z, radius * 1.3, Math.round(10 + radius * 4), host);
    host.rumble(0.3, 0.5, x, z);
  }

  /** Earthquake: the ground splits outward from the stomp, rocks hop into the air, the view rumbles. */
  private quake(x: number, z: number, radius: number, host: EffectHost): void {
    if (!this.terrain) return;
    this.addCracks(x, z, radius, false);
    this.hopStones(x, z, radius * 1.15, Math.round(12 + radius * radius * 1.3), host);
    host.rumble(0.3 + radius * 0.03, 0.8 + radius * 0.08, x, z);
  }

  /** Pebbles (and a few slabs near the centre) jolted into the air, the far ones as the wave arrives. */
  private hopStones(x: number, z: number, radius: number, count: number, host: EffectHost): void {
    const terrain = this.terrain;
    if (!terrain) return;
    const n = Math.min(80, count);
    for (let i = 0; i < n; i++) {
      const slab = i < 4;
      const a = Math.random() * Math.PI * 2;
      const r = radius * (slab ? 0.1 + Math.random() * 0.25 : 0.12 + 0.88 * Math.sqrt(Math.random()));
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (terrain.inWater(px, pz)) continue;
      const near = 1 - r / radius;
      host.debris({
        x: px,
        y: terrain.height(px, pz) + 0.05,
        z: pz,
        hx: 0.05,
        hy: 0.02,
        hz: 0.05,
        count: 1,
        colors: ROCKS,
        dx: Math.cos(a) * 0.25,
        dz: Math.sin(a) * 0.25,
        force: 4 + Math.random() * 4 + near * 5,
        size: slab ? [0.3, 0.55] : [0.07, 0.24],
        delay: (r / radius) * 0.28,
      });
    }
  }

  /** Tearing hit: more flesh, a red flash; bites snap jaws shut on the target, slashing claws rake it. */
  private tear(w: WeaponDef, e: Extract<SimEvent, { type: 'hit' }>, host: EffectHost): void {
    const size = THREE.MathUtils.clamp(0.5 + e.damage / 120, 0.6, 2);
    const chunk = this.particleDefs.get('hit-chunk');
    if (chunk) {
      this.dir.x = e.dx;
      this.dir.y = 0.8;
      this.dir.z = e.dz;
      host.particles.emit(chunk, e.x, e.y, e.z, this.dir, Math.min(20, Math.round(e.damage / 12)), 0.8 + size * 0.3);
    }
    this.v1.set(e.x, e.y, e.z);
    this.flash(this.v1, '#ff4a3a', 1.5 + size, 0.14, true);
    const first = this.biteFrame !== this.frame;
    this.biteFrame = this.frame;
    if (!first) return;
    if (e.damage >= 80) host.shake(Math.min(0.3, 0.05 + e.damage / 1500), e.x, e.z);
    const bite = w.id.includes('bite');
    if ((!bite && w.damageType !== 'slash') || this.jaws.length >= 24) return;
    const len = Math.hypot(e.dx, e.dz) || 1;
    this.jaws.push({ claw: !bite, x: e.x, y: e.y, z: e.z, fx: e.dx / len, fz: e.dz / len, size, age: 0, life: bite ? 0.34 : 0.3 });
  }

  // ------------------------------------------------------------------ ground cracks

  /** Jagged cracks running out from (x, z), branching; they open as the shock front passes. */
  private addCracks(x: number, z: number, radius: number, hot: boolean): void {
    const terrain = this.terrain;
    if (!terrain) return;
    if (this.cracks.length >= 20) this.cracks.shift();
    const segs: number[] = [];
    const speed = radius / 0.28;
    const width = THREE.MathUtils.clamp(radius * 0.045, 0.09, 0.3);
    const dust = this.particleDefs.get(hot ? 'ember' : 'hit-dust');
    const y = (px: number, pz: number) => groundY(terrain, px, pz) + 0.035;
    const grow = (sx: number, sz: number, a: number, len: number, w: number, dist: number, branch: boolean): void => {
      const steps = THREE.MathUtils.clamp(Math.round(len / 0.55), 3, 9);
      const step = len / steps;
      let px = sx;
      let pz = sz;
      let py = y(px, pz);
      for (let i = 0; i < steps; i++) {
        a += (Math.random() - 0.5) * 0.75;
        const nx = px + Math.cos(a) * step;
        const nz = pz + Math.sin(a) * step;
        const ny = y(nx, nz);
        segs.push(px, py, pz, nx, ny, nz, w * (1 - (i / steps) * 0.75), dist / speed);
        dist += step;
        if (branch && i >= 1 && i < steps - 1 && Math.random() < 0.35) {
          grow(nx, nz, a + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5), len * 0.4, w * 0.6, dist, false);
        }
        px = nx;
        pz = nz;
        py = ny;
      }
      // Dust spurts out where the crack stops.
      if (branch && dust) this.schedule(this.time + dist / speed, dust, px, py, pz, 3, 0.8, false);
    };
    const arms = Math.min(11, 5 + Math.round(radius * 0.8));
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const r0 = radius * 0.08;
      grow(x + Math.cos(a) * r0, z + Math.sin(a) * r0, a, radius * (0.65 + Math.random() * 0.45), width, r0, true);
    }
    this.cracks.push({ segs: new Float32Array(segs), age: 0, life: hot ? 10 : 7, hot });
  }

  private updateCracks(dt: number): void {
    let n = 0;
    for (let c = this.cracks.length - 1; c >= 0; c--) {
      const k = this.cracks[c];
      k.age += dt;
      if (k.age >= k.life) {
        this.cracks.splice(c, 1);
        continue;
      }
      // Cracks narrow shut as they fade; molten ones cool from glowing orange to charred.
      const fade = Math.min(1, (k.life - k.age) / 1.5);
      this.c1.copy(CRACK_DARK);
      if (k.hot) this.c1.lerp(LAVA, Math.max(0, 1 - k.age / 2.5));
      const s = k.segs;
      for (let i = 0; i < s.length && n < CRACK_CAP; i += CRACK_STRIDE) {
        const g = (k.age - s[i + 7]) / CRACK_OPEN;
        if (g <= 0) continue;
        const f = Math.min(1, g);
        this.v1.set(s[i], s[i + 1], s[i + 2]);
        this.v2.set(s[i + 3], s[i + 4], s[i + 5]).sub(this.v1).multiplyScalar(f).add(this.v1);
        const dir = this.v3.subVectors(this.v2, this.v1);
        const len = dir.length();
        if (len < 1e-3) continue;
        this.q.setFromUnitVectors(zAxis, dir.divideScalar(len));
        const w = s[i + 6] * fade;
        this.m.compose(this.v1.add(this.v2).multiplyScalar(0.5), this.q, this.s.set(w, 0.03, len + w * 0.5));
        this.crackMesh.setMatrixAt(n, this.m);
        this.crackMesh.setColorAt(n, this.c1);
        n++;
      }
    }
    commitInstances(this.crackMesh, n);
  }

  // ------------------------------------------------------------------ delayed bursts

  private schedule(at: number, def: ParticleDef, x: number, y: number, z: number, count: number, size: number, up: boolean): void {
    if (this.later.length < 256) this.later.push({ at, def, x, y, z, count, size, up });
  }

  private updateLater(host: EffectHost): void {
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i];
      if (l.at > this.time) continue;
      host.particles.emit(l.def, l.x, l.y, l.z, l.up ? UP : undefined, l.count, l.size);
      this.later[i] = this.later[this.later.length - 1];
      this.later.pop();
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, sim: BattleSim | null, alpha: number, host: EffectHost): void {
    this.frame++;
    this.time += dt;
    this.updateBolts(dt, host);
    this.updateRings(dt);
    this.updateFlashes(dt);
    this.updateMeteors(dt, host);
    this.updateCracks(dt);
    this.updateLater(host);
    if (sim) {
      this.updateWhirls(dt, sim, alpha, host);
      if (dt > 0) this.unitEffects(dt, sim, host);
    }
  }

  private unitEffects(dt: number, sim: BattleSim, host: EffectHost): void {
    for (const u of sim.units) {
      if (!u.alive) continue;
      if (u.burnLeft > 0 && this.burnDef && Math.random() < this.burnDef.rate * dt * Math.min(2.5, u.def.radius * 2) && host.chest(u.id, this.v1)) {
        host.particles.emit(this.burnDef, this.v1.x, this.v1.y - u.def.height * 0.15, this.v1.z, undefined, 1, Math.max(1, u.def.radius * 1.6));
      }
      const act = u.action;
      if (!act || !act.skill || u.windupLeft < 0) continue;
      // Cast glow: crackling arcs for lightning, sparks of the skill's own particle otherwise.
      const w = act.def;
      const lightning = w.attack === 'chain' || (w.attack === 'strike' && w.strikeVfx === 'lightning');
      if (lightning) {
        if (Math.random() < dt * 14 && host.emitPoint(u.id, this.v1)) {
          this.v2.set(this.v1.x + (Math.random() - 0.5) * 0.9, this.v1.y + (Math.random() - 0.3) * 0.9, this.v1.z + (Math.random() - 0.5) * 0.9);
          this.addBolt({ a: this.v1, b: this.v2 }, w.vfxColor, 0.025, 0.12, false, host);
          if (Math.random() < 0.35) this.flash(this.v1, w.vfxColor, 1.5, 0.12);
        }
      } else if (w.attack === 'vortex') {
        // Dust starts spinning around the caster's feet.
        const def = w.areaParticleId ? this.particleDefs.get(w.areaParticleId) : undefined;
        if (def && Math.random() < dt * 18 && host.chest(u.id, this.v1)) host.particles.emit(def, this.v1.x, this.v1.y - u.def.height * 0.45, this.v1.z, undefined, 1, 0.6);
      } else {
        const id = w.fireParticleId ?? w.hitParticleId ?? w.areaParticleId;
        const def = id ? this.particleDefs.get(id) : undefined;
        if (def && Math.random() < dt * 18 && host.emitPoint(u.id, this.v1)) host.particles.emit(def, this.v1.x, this.v1.y, this.v1.z, { x: 0, y: 1, z: 0 }, 1, 0.6);
      }
    }
  }

  // ------------------------------------------------------------------ bolts

  private addBolt(
    ends: { a: THREE.Vector3; b: THREE.Vector3 } | { fromUnit: number; fromChest: boolean; toUnit: number },
    color: string,
    width: number,
    life: number,
    sky: boolean,
    host: EffectHost,
  ): void {
    if (this.bolts.length > 160) return;
    const bolt: Bolt = this.boltPool.pop() ?? {
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      fromUnit: -1,
      fromChest: false,
      toUnit: -1,
      age: 0,
      life: 0,
      color: new THREE.Color(),
      width: 0,
      rough: 0,
      sky: false,
      forks: 0,
      flickerAt: 0,
      pts: Array.from({ length: (1 << BOLT_LEVELS) + 1 }, () => new THREE.Vector3()),
      fork: [],
    };
    bolt.fromUnit = 'fromUnit' in ends ? ends.fromUnit : -1;
    bolt.fromChest = 'fromUnit' in ends && ends.fromChest;
    bolt.toUnit = 'toUnit' in ends ? ends.toUnit : -1;
    bolt.age = 0;
    bolt.life = life;
    bolt.color.set(color);
    bolt.width = width;
    bolt.rough = sky ? 0.22 : 0.3;
    bolt.sky = sky;
    bolt.forks = sky ? 3 : width > 0.04 ? 1 : 0;
    bolt.flickerAt = 0;
    while (bolt.fork.length < bolt.forks) bolt.fork.push(Array.from({ length: (1 << FORK_LEVELS) + 1 }, () => new THREE.Vector3()));
    if ('a' in ends) {
      bolt.a.copy(ends.a);
      bolt.b.copy(ends.b);
    } else if (!this.boltEnds(bolt, host)) {
      this.boltPool.push(bolt);
      return;
    }
    this.bolts.push(bolt);
  }

  /** Re-reads the ends of a bolt tied to units (they keep moving while it crackles). */
  private boltEnds(bolt: Bolt, host: EffectHost): boolean {
    if (bolt.fromUnit < 0) return true;
    const from = bolt.fromChest ? host.chest(bolt.fromUnit, this.v3) : host.emitPoint(bolt.fromUnit, this.v3);
    if (!from) return false;
    bolt.a.copy(this.v3);
    if (!host.chest(bolt.toUnit, this.v3)) return false;
    bolt.b.copy(this.v3);
    return true;
  }

  private updateBolts(dt: number, host: EffectHost): void {
    let n = 0;
    const colors = this.boltColors;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      bolt.age += dt;
      if (bolt.age >= bolt.life) {
        this.bolts.splice(i, 1);
        this.boltPool.push(bolt);
        continue;
      }
      this.boltEnds(bolt, host);
      if (bolt.age >= bolt.flickerAt || dt === 0) {
        this.jag(bolt.a, bolt.b, bolt.pts, BOLT_LEVELS, bolt.rough);
        for (let f = 0; f < bolt.forks; f++) {
          const fork = bolt.fork[f];
          const from = bolt.pts[4 + Math.floor(Math.random() * ((1 << BOLT_LEVELS) - 7))];
          const len = bolt.a.distanceTo(bolt.b) * (bolt.sky ? 0.22 : 0.3);
          this.v3.set(Math.random() - 0.5, bolt.sky ? -0.9 : Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(len).add(from);
          this.jag(from, this.v3, fork, FORK_LEVELS, 0.35);
        }
        bolt.flickerAt = bolt.age + 0.04 + Math.random() * 0.05;
      }
      const t = bolt.age / bolt.life;
      // Sky bolts re-strike: bright, dim, bright, then fade.
      const pulse = bolt.sky ? (t < 0.15 ? 1 : t < 0.3 ? 0.35 : t < 0.45 ? 1 : 1 - (t - 0.45) / 0.55) : 1 - t * t;
      const k = pulse * (0.8 + Math.random() * 0.2);
      n = this.drawPolyline(bolt.pts, bolt.width, bolt.color, k, n, colors);
      for (let f = 0; f < bolt.forks; f++) n = this.drawPolyline(bolt.fork[f], bolt.width * 0.5, bolt.color, k * 0.7, n, colors);
    }
    n = this.drawJaws(dt, n, colors);
    commitInstances(this.core, n);
    commitInstances(this.glow, n);
  }

  /** Two rows of teeth closing on the bite, drawn as glowing zig-zag arcs across the attack direction. */
  private drawJaws(dt: number, n: number, colors: Float32Array[]): number {
    const pts = this.jawPts;
    const last = pts.length - 1;
    for (let j = this.jaws.length - 1; j >= 0; j--) {
      const jaw = this.jaws[j];
      jaw.age += dt;
      if (jaw.age >= jaw.life) {
        this.jaws.splice(j, 1);
        continue;
      }
      const t = jaw.age / jaw.life;
      const s = jaw.size;
      // Lateral axis across the target; the marks curve back toward the attacker.
      const lx = -jaw.fz;
      const lz = jaw.fx;
      if (jaw.claw) {
        // Three parallel rakes swept diagonally, top to bottom, in 0.08 s.
        const sweep = Math.min(1, jaw.age / 0.08) * 2 - 1;
        const k = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
        for (let c = -1; c <= 1; c++) {
          for (let i = 0; i <= last; i++) {
            const u = Math.min((i / last) * 2 - 1, sweep);
            const along = u * s * 0.6;
            const across = c * s * 0.2;
            const lat = along * 0.7 + across * 0.7;
            const up = -along * 0.7 + across * 0.7;
            const back = -(1 - u * u) * s * 0.15;
            pts[i].set(jaw.x + lx * lat + jaw.fx * back, jaw.y + up, jaw.z + lz * lat + jaw.fz * back);
          }
          n = this.drawPolyline(pts, 0.035 * s * (c === 0 ? 1 : 0.8), CLAW, k, n, colors);
        }
        continue;
      }
      const open = 1 - Math.min(1, jaw.age / 0.09) * 0.85;
      const k = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
      for (const side of [1, -1]) {
        for (let i = 0; i <= last; i++) {
          const u = (i / last) * 2 - 1;
          const tooth = i % 2 === 1 ? s * 0.16 : 0;
          const h = side * ((s * (0.5 - 0.3 * u * u) - tooth) * open + s * 0.04);
          const back = -(1 - u * u) * s * 0.3;
          pts[i].set(jaw.x + lx * u * s * 0.7 + jaw.fx * back, jaw.y + h, jaw.z + lz * u * s * 0.7 + jaw.fz * back);
        }
        n = this.drawPolyline(pts, 0.045 * s, JAW, k, n, colors);
      }
    }
    return n;
  }

  /** Midpoint displacement between a and b into pts (2^levels + 1 points). */
  private jag(a: THREE.Vector3, b: THREE.Vector3, pts: THREE.Vector3[], levels: number, rough: number): void {
    const N = 1 << levels;
    pts[0].copy(a);
    pts[N].copy(b);
    for (let step = N; step > 1; step >>= 1) {
      const half = step >> 1;
      for (let i = 0; i < N; i += step) {
        const p = pts[i];
        const q = pts[i + step];
        const seg = this.v1.subVectors(q, p);
        const len = seg.length();
        const r = this.v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        r.addScaledVector(seg, -r.dot(seg) / Math.max(1e-6, len * len)).normalize();
        pts[i + half].addVectors(p, q).multiplyScalar(0.5).addScaledVector(r, (Math.random() * 2 - 1) * len * rough);
      }
    }
  }

  private drawPolyline(pts: THREE.Vector3[], width: number, color: THREE.Color, k: number, n: number, colors: Float32Array[]): number {
    for (let i = 0; i < pts.length - 1 && n < SEGMENT_CAP; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dir = this.v1.subVectors(b, a);
      const len = dir.length();
      if (len < 1e-4) continue;
      this.q.setFromUnitVectors(zAxis, dir.divideScalar(len));
      const mid = this.v2.addVectors(a, b).multiplyScalar(0.5);
      // The core thins out as the bolt fades; the halo dims.
      const core = width * (0.35 + 0.65 * k);
      this.m.compose(mid, this.q, this.s.set(core, core, len + core));
      this.core.setMatrixAt(n, this.m);
      const halo = width * 4.5 * (0.3 + 0.7 * k);
      this.m.compose(mid, this.q, this.s.set(halo, halo, len + halo * 0.6));
      this.glow.setMatrixAt(n, this.m);
      this.c1.copy(color).lerp(WHITE, 0.65);
      const c = n * 3;
      colors[0][c] = this.c1.r;
      colors[0][c + 1] = this.c1.g;
      colors[0][c + 2] = this.c1.b;
      colors[1][c] = color.r;
      colors[1][c + 1] = color.g;
      colors[1][c + 2] = color.b;
      n++;
    }
    return n;
  }

  // ------------------------------------------------------------------ rings & scorch

  private addRing(kind: RingKind, x: number, z: number, radius: number, life: number, color: string): void {
    let ring = this.rings.find((r) => !r.active && r.kind === kind);
    if (!ring) {
      if (this.rings.filter((r) => r.kind === kind).length >= (kind === 'scorch' ? 48 : 40)) {
        // Recycle the oldest one of this kind.
        ring = this.rings.filter((r) => r.kind === kind).sort((p, q) => q.age / q.life - p.age / p.life)[0];
      } else {
        ring = this.createRing(kind);
      }
    }
    ring.active = true;
    ring.x = x;
    ring.z = z;
    ring.radius = radius;
    ring.age = 0;
    ring.life = Math.max(0.05, life);
    ring.color.set(color);
    for (let i = 0; i <= RING_SEG; i++) ring.edge[i] = kind === 'scorch' ? 0.75 + Math.random() * 0.4 : 1;
    ring.edge[RING_SEG] = ring.edge[0];
    ring.built = false;
    ring.mesh.visible = true;
  }

  private createRing(kind: RingKind): Ring {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RING_SEG + 1) * 3 * 3), 3));
    const colors = new Float32Array((RING_SEG + 1) * 3 * 3);
    const profile = RING_PROFILE[kind];
    for (let i = 0; i < colors.length; i++) colors[i] = profile[Math.floor(i / 3) % 3];
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const index: number[] = [];
    for (let i = 0; i < RING_SEG; i++) {
      for (let j = 0; j < 2; j++) {
        const a = i * 3 + j;
        index.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
    geo.setIndex(index);
    const scorch = kind === 'scorch';
    const material = new THREE.MeshBasicMaterial({
      color: scorch ? '#150e09' : '#ffffff',
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: scorch ? THREE.NormalBlending : THREE.AdditiveBlending,
      toneMapped: scorch,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: scorch ? -1 : -3,
      polygonOffsetUnits: scorch ? -1 : -3,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = scorch ? 1 : 2;
    if (!scorch) mesh.layers.enable(GLOW_LAYER);
    this.group.add(mesh);
    const ring: Ring = { mesh, kind, x: 0, z: 0, radius: 1, age: 0, life: 1, color: new THREE.Color(), edge: new Float32Array(RING_SEG + 1), active: false, built: false };
    this.rings.push(ring);
    return ring;
  }

  private updateRings(dt: number): void {
    const terrain = this.terrain;
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.age += dt;
      const t = ring.age / ring.life;
      if (t >= 1 || !terrain) {
        ring.active = false;
        ring.mesh.visible = false;
        continue;
      }
      const R = ring.radius;
      // Radii of the inner, core (brightest) and outer rows.
      let inner: number;
      let core: number;
      let outer: number;
      let k: number;
      switch (ring.kind) {
        case 'telegraph': {
          const w = THREE.MathUtils.clamp(R * 0.05, 0.1, 0.22);
          outer = R;
          core = R - w * 0.3;
          inner = R - w;
          k = (0.9 + 0.25 * Math.sin(ring.age * 12)) * (0.7 + 0.5 * t);
          break;
        }
        case 'fill':
          outer = R * t;
          core = outer * 0.8;
          inner = 0;
          k = 0.08 + 0.12 * t;
          break;
        case 'shock': {
          const e = 1 - (1 - t) ** 3;
          outer = R * (0.25 + 0.9 * e);
          const thick = R * 0.25 * (1 - t) + 0.06;
          core = outer - thick * 0.2;
          inner = outer - thick;
          k = 1.4 * (1 - t) ** 1.5;
          break;
        }
        case 'halo': {
          // Soft static glow under the feet: fades in, then out.
          const w = THREE.MathUtils.clamp(R * 0.1, 0.08, 0.18);
          outer = R;
          core = R - w * 0.35;
          inner = R - w;
          k = 0.8 * Math.sin(Math.PI * t);
          break;
        }
        case 'scorch':
          outer = R;
          core = R * 0.5;
          inner = 0;
          k = t < 0.7 ? 0.48 : 0.48 * (1 - (t - 0.7) / 0.3);
          break;
      }
      if (ring.kind === 'scorch') ring.mesh.material.opacity = k;
      else ring.mesh.material.color.copy(ring.color).multiplyScalar(k);
      if (ring.built) continue;
      ring.built = ring.kind === 'scorch' || ring.kind === 'telegraph' || ring.kind === 'halo';
      const pos = ring.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const lift = ring.kind === 'scorch' ? 0.05 : 0.09;
      for (let i = 0; i <= RING_SEG; i++) {
        const a = (i / RING_SEG) * Math.PI * 2;
        const cx = Math.cos(a);
        const sz = Math.sin(a);
        const e = ring.edge[i];
        for (let j = 0; j < 3; j++) {
          const r = j === 0 ? Math.max(0, inner) : j === 1 ? Math.max(0, core) : outer * e;
          const px = ring.x + cx * r;
          const pz = ring.z + sz * r;
          const o = (i * 3 + j) * 3;
          arr[o] = px;
          arr[o + 1] = groundY(terrain, px, pz) + lift;
          arr[o + 2] = pz;
        }
      }
      pos.needsUpdate = true;
    }
  }

  private ringBurst(particleId: string | null, x: number, y: number, z: number, radius: number, host: EffectHost): void {
    const def = particleId ? this.particleDefs.get(particleId) : undefined;
    if (!def) return;
    const spots = Math.max(1, Math.min(10, Math.round(radius * 1.6)));
    const per = Math.max(2, Math.round((def.count * (1 + radius * 0.15)) / spots));
    host.particles.emit(def, x, y, z, undefined, per);
    for (let i = 0; i < spots; i++) {
      const a = (i / spots) * Math.PI * 2 + Math.random() * 0.5;
      const r = radius * (0.55 + Math.random() * 0.4);
      host.particles.emit(def, x + Math.cos(a) * r, y, z + Math.sin(a) * r, { x: Math.cos(a), y: 0.8, z: Math.sin(a) }, per);
    }
  }

  // ------------------------------------------------------------------ flashes

  /** `idleOnly`: frequent small flashes take a free light and never cut short a big one. */
  private flash(at: THREE.Vector3, color: string, intensity: number, life: number, idleOnly = false): void {
    if (this.flashes.length === 0) return;
    let f = this.flashes[this.flashNext];
    if (idleOnly) {
      const free = this.flashes.find((l) => l.age >= l.life);
      if (!free) return;
      f = free;
    } else {
      this.flashNext = (this.flashNext + 1) % this.flashes.length;
    }
    f.light.position.copy(at);
    f.light.color.set(color).lerp(WHITE, 0.3);
    f.age = 0;
    f.life = life;
    f.peak = intensity * 18;
  }

  private updateFlashes(dt: number): void {
    for (const f of this.flashes) {
      f.age += dt;
      const t = f.age / f.life;
      f.light.intensity = t >= 1 ? 0 : f.peak * (1 - t) * (1 - t);
    }
  }

  // ------------------------------------------------------------------ meteors

  private addMeteor(w: WeaponDef, e: Extract<SimEvent, { type: 'warn' }>, host: EffectHost): void {
    const def = w.projectileId ? this.projectileDefs.get(w.projectileId) : undefined;
    let geo = this.meteorGeo.get(def?.id ?? '');
    if (!geo) {
      geo = mergeTemplate(bakeModel(createProjectileModel(def ?? { model: 'meteor', color: '#ff6a1a', scale: 1.6 })));
      this.meteorGeo.set(def?.id ?? '', geo);
    }
    // Come in from behind the caster, steep, so it reads against the sky.
    let dx = 0.5;
    let dz = 0.3;
    if (host.chest(e.unitId, this.v1)) {
      dx = e.x - this.v1.x;
      dz = e.z - this.v1.z;
    }
    const len = Math.hypot(dx, dz) || 1;
    const to = new THREE.Vector3(e.x, e.y + 0.4, e.z);
    const from = new THREE.Vector3(e.x - (dx / len) * 18 + (Math.random() - 0.5) * 6, e.y + 42, e.z - (dz / len) * 18 + (Math.random() - 0.5) * 6);
    const mesh = new THREE.Mesh(geo, this.meteorMaterial);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.position.copy(from);
    this.group.add(mesh);
    const trail = def?.trailParticleId ? this.particleDefs.get(def.trailParticleId) ?? null : null;
    this.meteors.push({ mesh, from, to, age: 0, life: Math.max(0.2, e.delay), trail, trailAcc: 0 });
  }

  private updateMeteors(dt: number, host: EffectHost): void {
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.age += dt;
      const t = Math.min(1, m.age / m.life);
      // Accelerates as it falls.
      const k = t * t * (1.4 - 0.4 * t);
      this.v1.lerpVectors(m.from, m.to, k);
      this.v2.subVectors(m.to, m.from).normalize();
      m.mesh.position.copy(this.v1);
      m.mesh.quaternion.setFromUnitVectors(zAxis, this.v2);
      m.mesh.rotateZ(m.age * 3);
      if (m.trail && dt > 0) {
        m.trailAcc += m.trail.rate * dt * 2.5;
        const whole = Math.floor(m.trailAcc);
        m.trailAcc -= whole;
        if (whole > 0) host.particles.emit(m.trail, this.v1.x, this.v1.y, this.v1.z, undefined, whole, 2.4);
      }
      if (m.age > m.life + 0.25) this.removeMeteor(i);
    }
  }

  private removeMeteor(i: number): void {
    const [m] = this.meteors.splice(i, 1);
    this.group.remove(m.mesh);
  }

  // ------------------------------------------------------------------ whirlwinds

  private updateWhirls(dt: number, sim: BattleSim, alpha: number, host: EffectHost): void {
    const terrain = this.terrain;
    if (!terrain) return;
    for (const zn of sim.zones) {
      let whirl = this.whirls.get(zn.id);
      if (!whirl) {
        whirl = this.createWhirl(zn.weapon, zn.radius);
        this.whirls.set(zn.id, whirl);
      }
      whirl.seen = this.frame;
      const x = zn.px + (zn.x - zn.px) * alpha;
      const z = zn.pz + (zn.z - zn.pz) * alpha;
      whirl.group.position.set(x, groundY(terrain, x, z), z);
    }
    for (const [id, whirl] of this.whirls) {
      whirl.age += dt;
      if (whirl.seen !== this.frame) whirl.fade -= dt / 0.7;
      if (whirl.fade <= 0) {
        this.group.remove(whirl.group);
        this.whirls.delete(id);
        continue;
      }
      const grow = Math.min(1, whirl.age / 0.6);
      const s = grow * grow * (3 - 2 * grow) * Math.max(0, whirl.fade);
      whirl.group.scale.set(s, 0.3 + 0.7 * s, s);
      const r = whirl.radius;
      if (whirl.wind) {
        whirl.wind.kit.tick(this.time);
        whirl.wind.kit.animate(whirl.wind, this.time, whirl.wind.phase);
      }
      if (whirl.fire) {
        this.animateFireWhirl(whirl, whirl.fire, dt, host);
        continue;
      }
      if (whirl.dust && whirl.wind && dt > 0 && whirl.fade > 0.5) {
        // Dust kicked up at the foot, then flung round the funnel as it climbs.
        const swirl = this.swirlDef(whirl.dust, [3, 7], [0.6, 1.2]);
        const h = whirl.wind.kit.height;
        whirl.dustAcc += whirl.dust.rate * dt * (0.6 + r * 0.25);
        const p = whirl.group.position;
        for (; whirl.dustAcc >= 1; whirl.dustAcc--) {
          const a = Math.random() * Math.PI * 2;
          const t = Math.random() ** 2 * 0.7;
          const rr = r * (0.3 + 1.2 * t ** 1.6) * (0.8 + Math.random() * 0.5);
          this.dir.x = -Math.sin(a);
          this.dir.y = 0.5;
          this.dir.z = Math.cos(a);
          host.particles.emit(t < 0.08 ? whirl.dust : swirl, p.x + Math.cos(a) * rr, p.y + 0.2 + t * h, p.z + Math.sin(a) * rr, this.dir, 1);
        }
      }
    }
  }

  /** Flames licking up the funnel, embers flung round it, flickering light. */
  private animateFireWhirl(whirl: Whirl, fire: NonNullable<Whirl['fire']>, dt: number, host: EffectHost): void {
    const { kit } = fire;
    kit.tick(this.time);
    kit.animate(fire.spin, this.time, fire.phase);
    if (dt <= 0 || whirl.fade <= 0.5) return;
    const p = whirl.group.position;
    const r = whirl.radius;
    const h = kit.height;
    const flame = this.burnDef && this.swirlDef(this.burnDef, [2.5, 5], [0.35, 0.75]);
    if (flame) {
      fire.flameAcc += dt * (26 + r * 8);
      for (; fire.flameAcc >= 1; fire.flameAcc--) {
        const a = Math.random() * Math.PI * 2;
        const t = Math.random() ** 1.6 * 0.6;
        const rr = r * (0.35 + 0.95 * t ** 1.5) * (0.5 + Math.random() * 0.5);
        this.dir.x = -Math.sin(a) * 1.5;
        this.dir.y = 1;
        this.dir.z = Math.cos(a) * 1.5;
        host.particles.emit(flame, p.x + Math.cos(a) * rr, p.y + t * h, p.z + Math.sin(a) * rr, this.dir, 1, 2.2 + r * 0.5 * (1 - t));
      }
    }
    if (whirl.dust) {
      const ember = this.swirlDef(whirl.dust, [4, 9], whirl.dust.lifetime);
      whirl.dustAcc += whirl.dust.rate * dt * (0.6 + r * 0.25) + dt * 22;
      for (; whirl.dustAcc >= 1; whirl.dustAcc--) {
        const a = Math.random() * Math.PI * 2;
        const t = Math.random() * 0.9;
        const rr = r * (0.35 + 0.95 * t ** 1.5);
        this.dir.x = -Math.sin(a);
        this.dir.y = 0.8;
        this.dir.z = Math.cos(a);
        host.particles.emit(ember, p.x + Math.cos(a) * rr, p.y + t * h, p.z + Math.sin(a) * rr, this.dir, 1);
      }
    }
    if (this.time >= fire.lightAt) {
      fire.lightAt = this.time + 0.09 + Math.random() * 0.08;
      this.v1.set(p.x, p.y + h * 0.3, p.z);
      this.flash(this.v1, '#ff7a24', 2.5 + r * 0.8 + Math.random() * 1.5, 0.22, true);
    }
  }

  private swirlDef(def: ParticleDef, speed: [number, number], lifetime: [number, number]): ParticleDef {
    let d = this.swirlDefs.get(def.id);
    if (!d) {
      d = { ...def, direction: 'forward', spread: 0.35, speed, lifetime, emitRadius: Math.min(def.emitRadius, 0.3) };
      this.swirlDefs.set(def.id, d);
    }
    return d;
  }

  private createWhirl(w: WeaponDef, radius: number): Whirl {
    const dust = w.areaParticleId ? this.particleDefs.get(w.areaParticleId) ?? null : null;
    const height = 2.5 + radius * 2.2;
    const c = new THREE.Color(w.vfxColor);
    // Fiery colours become a column of flame; dusty ones are lit, translucent shells.
    if (c.r > 0.75 && c.g < 0.65 && c.b < 0.4) {
      const fireKey = `${w.vfxColor}|${radius}`;
      let kit = this.fireKits.get(fireKey);
      if (!kit) {
        kit = new FireWhirlKit(radius, height, w.vfxColor);
        this.fireKits.set(fireKey, kit);
      }
      const { group, spin } = kit.build();
      this.group.add(group);
      const fire = { kit, spin, phase: Math.random() * 10, flameAcc: 0, lightAt: 0 };
      return { group, radius, age: 0, fade: 1, seen: this.frame, dust, dustAcc: 0, fire, wind: null };
    }
    const windKey = `${w.vfxColor}|${radius}`;
    let kit = this.windKits.get(windKey);
    if (!kit) {
      kit = new WindWhirlKit(radius, height, w.vfxColor);
      this.windKits.set(windKey, kit);
    }
    const { group, spin, ring, debris } = kit.build();
    this.group.add(group);
    const wind = { kit, spin, ring, debris, phase: Math.random() * 10 };
    return { group, radius, age: 0, fade: 1, seen: this.frame, dust, dustAcc: 0, fire: null, wind };
  }

  // ------------------------------------------------------------------ lifecycle

  clear(): void {
    this.boltPool.push(...this.bolts);
    this.bolts.length = 0;
    this.core.count = 0;
    this.glow.count = 0;
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const f of this.flashes) {
      f.age = f.life;
      f.light.intensity = 0;
    }
    while (this.meteors.length) this.removeMeteor(0);
    for (const w of this.whirls.values()) this.group.remove(w.group);
    this.whirls.clear();
    this.cracks.length = 0;
    this.crackMesh.count = 0;
    this.jaws.length = 0;
    this.later.length = 0;
  }

  dispose(): void {
    this.clear();
    this.core.geometry.dispose();
    (this.core.material as THREE.Material).dispose();
    (this.glow.material as THREE.Material).dispose();
    this.core.dispose();
    this.glow.dispose();
    (this.crackMesh.material as THREE.Material).dispose();
    this.crackMesh.dispose();
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
    }
    for (const g of this.meteorGeo.values()) g.dispose();
    this.meteorMaterial.dispose();
    for (const kit of this.fireKits.values()) kit.dispose();
    for (const kit of this.windKits.values()) kit.dispose();
  }
}

const WHITE = new THREE.Color('#ffffff');
const JAW = new THREE.Color('#ff3b2e');
const CLAW = new THREE.Color('#ff6a3a');
const HEAL_HEX = '#5dff7a';
const CRACK_DARK = new THREE.Color('#1c130c');
const LAVA = new THREE.Color('#ff7a1a').multiplyScalar(1.6);

/** Fire-coloured additive particle burning out to black (flames, blasts). */
function isFiery(def: ParticleDef, c: THREE.Color): boolean {
  if (!def.additive) return false;
  c.set(def.colorStart);
  if (c.r < 0.8 || c.b > 0.6) return false;
  c.set(def.colorEnd);
  return Math.max(c.r, c.g, c.b) < 0.2;
}

function groundY(terrain: Terrain, x: number, z: number): number {
  const h = terrain.height(x, z);
  return terrain.inWater(x, z) ? Math.max(h, terrain.waterLevel) : h;
}
