// Skill effects: lightning bolts, telegraph circles, shockwaves, scorch marks, falling meteors,
// whirlwinds, cast glows, burning units, light flashes and camera shake.
// Driven by sim events plus read-only sim state; purely cosmetic (never feeds the sim).
import * as THREE from 'three';
import type { ConfigBundle, ParticleDef, ProjectileDef, WeaponDef } from '@/shared/schema';
import { bakeModel, mergeTemplate, type ModelTemplate } from '../models/bake';
import { createTornadoModel } from '../models/effects';
import { createProjectileModel } from '../models/projectiles';
import type { Terrain } from '../sim/terrain';
import type { BattleSim, SimEvent } from '../sim/world';
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

const RING_SEG = 40;
type RingKind = 'telegraph' | 'fill' | 'shock' | 'scorch';

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
  /** Static rings (telegraph, scorch) only rebuild their vertices once. */
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
  bands: THREE.Mesh[];
  debris: THREE.Mesh | null;
  radius: number;
  age: number;
  fade: number;
  seen: number;
  dust: ParticleDef | null;
  dustAcc: number;
}

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
  private readonly whirlTemplates = new Map<string, { template: ModelTemplate; material: THREE.Material }>();
  private frame = 0;
  private time = 0;

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
    this.boltColors = [this.core.instanceColor!.array as Float32Array, this.glow.instanceColor!.array as Float32Array];
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
        const p = w?.projectileId ? this.projectileDefs.get(w.projectileId) : undefined;
        if (w && (w.castStyle === 'gun' || p?.model === 'bullet') && host.emitPoint(e.unitId, this.v1)) this.flash(this.v1, '#ffc56a', 4, 0.07);
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
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, sim: BattleSim | null, alpha: number, host: EffectHost): void {
    this.frame++;
    this.time += dt;
    this.updateBolts(dt, host);
    this.updateRings(dt);
    this.updateFlashes(dt);
    this.updateMeteors(dt, host);
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
    commitInstances(this.core, n);
    commitInstances(this.glow, n);
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
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RING_SEG + 1) * 2 * 3), 3));
    const index: number[] = [];
    for (let i = 0; i < RING_SEG; i++) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    geo.setIndex(index);
    const scorch = kind === 'scorch';
    const material = new THREE.MeshBasicMaterial({
      color: scorch ? '#150e09' : '#ffffff',
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
      let inner: number;
      let outer: number;
      let k: number;
      switch (ring.kind) {
        case 'telegraph': {
          const w = THREE.MathUtils.clamp(R * 0.08, 0.12, 0.35);
          outer = R;
          inner = R - w;
          k = (0.5 + 0.35 * Math.sin(ring.age * 22)) * (0.55 + 0.45 * t);
          break;
        }
        case 'fill':
          outer = R * t;
          inner = 0;
          k = 0.05 + 0.1 * t;
          break;
        case 'shock': {
          const e = 1 - (1 - t) ** 3;
          outer = R * (0.25 + 0.9 * e);
          inner = outer - R * 0.35 * (1 - t) - 0.05;
          k = (1 - t) ** 1.5;
          break;
        }
        case 'scorch':
          outer = R;
          inner = 0;
          k = t < 0.7 ? 0.48 : 0.48 * (1 - (t - 0.7) / 0.3);
          break;
      }
      if (ring.kind === 'scorch') ring.mesh.material.opacity = k;
      else ring.mesh.material.color.copy(ring.color).multiplyScalar(k);
      if (ring.built) continue;
      ring.built = ring.kind === 'scorch' || ring.kind === 'telegraph';
      const pos = ring.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const lift = ring.kind === 'scorch' ? 0.05 : 0.09;
      for (let i = 0; i <= RING_SEG; i++) {
        const a = (i / RING_SEG) * Math.PI * 2;
        const cx = Math.cos(a);
        const sz = Math.sin(a);
        const e = ring.edge[i];
        for (let j = 0; j < 2; j++) {
          const r = (j === 0 ? Math.max(0, inner) : outer) * (j === 1 ? e : 1);
          const px = ring.x + cx * r;
          const pz = ring.z + sz * r;
          const o = (i * 2 + j) * 3;
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

  private flash(at: THREE.Vector3, color: string, intensity: number, life: number): void {
    if (this.flashes.length === 0) return;
    const f = this.flashes[this.flashNext];
    this.flashNext = (this.flashNext + 1) % this.flashes.length;
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
      const time = this.time;
      whirl.bands.forEach((band, i) => {
        band.rotation.y = -time * (5.2 - i * 0.45) + i;
        band.position.x = Math.sin(time * 1.9 + i * 0.7) * i * 0.05 * r;
        band.position.z = Math.cos(time * 1.5 + i * 0.9) * i * 0.04 * r;
      });
      if (whirl.debris) whirl.debris.rotation.y = -time * 3.6;
      if (whirl.dust && dt > 0 && whirl.fade > 0.5) {
        whirl.dustAcc += whirl.dust.rate * dt * (0.6 + r * 0.25);
        const whole = Math.floor(whirl.dustAcc);
        whirl.dustAcc -= whole;
        const p = whirl.group.position;
        for (let k = 0; k < whole; k++) {
          const a = Math.random() * Math.PI * 2;
          const rr = r * (0.3 + Math.random() * 0.8);
          host.particles.emit(whirl.dust, p.x + Math.cos(a) * rr, p.y + 0.2, p.z + Math.sin(a) * rr, { x: -Math.sin(a), y: 0.6, z: Math.cos(a) }, 1);
        }
      }
    }
  }

  private createWhirl(w: WeaponDef, radius: number): Whirl {
    const key = `${w.id}|${w.vfxColor}|${radius}`;
    let entry = this.whirlTemplates.get(key);
    if (!entry) {
      const template = bakeModel(createTornadoModel({ radius, height: 2.5 + radius * 2.2, color: w.vfxColor, seed: 11 }));
      const c = new THREE.Color(w.vfxColor);
      // Fiery colours burn unlit; dusty ones are lit, translucent shells.
      const hot = c.r > 0.75 && c.g < 0.65 && c.b < 0.4;
      const material = hot
        ? new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.66, depthWrite: false, side: THREE.DoubleSide, roughness: 1 });
      entry = { template, material };
      this.whirlTemplates.set(key, entry);
    }
    const group = new THREE.Group();
    const bands: THREE.Mesh[] = [];
    let debris: THREE.Mesh | null = null;
    const pos = new THREE.Vector3();
    for (const p of entry.template.parts) {
      if (!p.geometry) continue;
      const mesh = new THREE.Mesh(p.geometry, entry.material);
      mesh.frustumCulled = false;
      pos.setFromMatrixPosition(p.rest);
      mesh.position.copy(pos);
      mesh.renderOrder = 2;
      group.add(mesh);
      if (p.local === 'debris') debris = mesh;
      else if (p.local.startsWith('band')) bands.push(mesh);
    }
    this.group.add(group);
    const dust = w.areaParticleId ? this.particleDefs.get(w.areaParticleId) ?? null : null;
    return { group, bands, debris, radius, age: 0, fade: 1, seen: this.frame, dust, dustAcc: 0 };
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
  }

  dispose(): void {
    this.clear();
    this.core.geometry.dispose();
    (this.core.material as THREE.Material).dispose();
    (this.glow.material as THREE.Material).dispose();
    this.core.dispose();
    this.glow.dispose();
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
    }
    for (const g of this.meteorGeo.values()) g.dispose();
    this.meteorMaterial.dispose();
    for (const { template, material } of this.whirlTemplates.values()) {
      for (const p of template.parts) p.geometry?.dispose();
      material.dispose();
    }
  }
}

const WHITE = new THREE.Color('#ffffff');

function groundY(terrain: Terrain, x: number, z: number): number {
  const h = terrain.height(x, z);
  return terrain.inWater(x, z) ? Math.max(h, terrain.waterLevel) : h;
}
