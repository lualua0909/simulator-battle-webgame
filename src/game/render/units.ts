// Instanced unit rendering: one InstancedMesh per (unit type, part). Alive units are
// posed procedurally with spring "wobble"; dead units hand over to Rapier ragdolls and
// finally freeze into corpses.
import * as THREE from 'three';
import type { AssetDef, ConfigBundle, Settings, WeaponDef } from '@/shared/schema';
import { getUnitTemplate } from '../models';
import type { ModelTemplate } from '../models/bake';
import type { Side } from '../sim/terrain';
import { SIM_DT, type BattleSim, type SimEvent, type SimUnit } from '../sim/world';
import { attackStyleFor, Poser, type AttackStyle } from './animate';
import type { Ragdoll, RagdollWorld } from './ragdoll';

const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
const STRIKE_TIME = 0.45;
const RAGDOLL_SECONDS = 6;

interface TypeVis {
  template: ModelTemplate;
  poser: Poser;
  style: AttackStyle;
  meshes: (THREE.InstancedMesh | null)[];
  used: number;
  refSpeed: number;
  stride: number;
}

interface UnitVis {
  type: TypeVis;
  seed: number;
  phase: number;
  speed: number;
  svx: number;
  svz: number;
  leanX: number;
  leanZ: number;
  vLeanX: number;
  vLeanZ: number;
  yaw: number;
  tumble: number;
  world: THREE.Matrix4[];
  ragdoll: Ragdoll | null;
  corpse: boolean;
  sink: number;
  gone: boolean;
}

type HitEvent = Extract<SimEvent, { type: 'hit' }>;
type DeathEvent = Extract<SimEvent, { type: 'death' }>;

export class UnitRenderer {
  readonly group = new THREE.Group();
  vis: UnitVis[] = [];
  private types = new Map<string, TypeVis>();
  private pose: THREE.Matrix4[] = [];
  private corpses: UnitVis[] = [];
  private ragdolls: RagdollWorld | null = null;
  private readonly assets: Map<string, AssetDef>;
  private readonly weapons: Map<string, WeaponDef>;
  private readonly rootM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpP = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  time = 0;

  constructor(bundle: ConfigBundle) {
    this.group.name = 'units';
    this.assets = new Map(bundle.assets.map((a) => [a.id, a]));
    this.weapons = new Map(bundle.weapons.map((w) => [w.id, w]));
  }

  setRagdolls(world: RagdollWorld | null): void {
    this.ragdolls = world;
  }

  build(sim: BattleSim): void {
    this.clear();
    const counts = new Map<string, number>();
    for (const u of sim.units) counts.set(u.def.id, (counts.get(u.def.id) ?? 0) + 1);
    let maxParts = 0;
    for (const [id, n] of counts) {
      const def = sim.units.find((u) => u.def.id === id)!.def;
      const template = getUnitTemplate(def, this.assets);
      const style = attackStyleFor(template, this.weapons.get(def.weaponId));
      const meshes = template.parts.map((p) => {
        if (!p.geometry) return null;
        const m = new THREE.InstancedMesh(p.geometry, material, n);
        m.count = 0;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        this.group.add(m);
        return m;
      });
      maxParts = Math.max(maxParts, template.parts.length);
      this.types.set(id, { template, poser: new Poser(template, style), style, meshes, used: 0, refSpeed: Math.max(1, def.speed), stride: Math.max(0.5, template.bounds.max.y * 0.32) });
    }
    this.pose = Array.from({ length: maxParts }, () => new THREE.Matrix4());
    this.vis = sim.units.map((u) => {
      const type = this.types.get(u.def.id)!;
      return {
        type,
        seed: ((u.id * 2654435761) >>> 0) / 4294967296,
        phase: Math.random() * Math.PI * 2,
        speed: 0,
        svx: 0,
        svz: 0,
        leanX: 0,
        leanZ: 0,
        vLeanX: 0,
        vLeanZ: 0,
        yaw: Math.atan2(u.fx, u.fz),
        tumble: 0,
        world: type.template.parts.map(() => new THREE.Matrix4()),
        ragdoll: null,
        corpse: false,
        sink: 0,
        gone: false,
      };
    });
    sim.units.forEach((u, i) => this.poseAlive(u, this.vis[i], sim, 1, 0));
  }

  update(sim: BattleSim, alpha: number, dt: number, hidden: Side | null): void {
    this.time += dt;
    for (const t of this.types.values()) t.used = 0;
    for (let i = 0; i < sim.units.length; i++) {
      const u = sim.units[i];
      const v = this.vis[i];
      if (!v || v.gone || (hidden && u.side === hidden)) continue;
      if (u.alive) this.poseAlive(u, v, sim, alpha, dt);
      else if (v.ragdoll && this.ragdolls) this.ragdolls.read(v.ragdoll, v.world);
      const t = v.type;
      const slot = t.used++;
      for (let k = 0; k < t.meshes.length; k++) {
        const mesh = t.meshes[k];
        if (!mesh) continue;
        if (v.sink > 0) {
          this.rootM.makeTranslation(0, -v.sink, 0).multiply(v.world[k]);
          mesh.setMatrixAt(slot, this.rootM);
        } else mesh.setMatrixAt(slot, v.world[k]);
      }
    }
    for (const t of this.types.values()) {
      for (const m of t.meshes) {
        if (!m) continue;
        m.count = t.used;
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private poseAlive(u: SimUnit, v: UnitVis, sim: BattleSim, alpha: number, dt: number): void {
    const x = u.px + (u.x - u.px) * alpha;
    const y = u.py + (u.y - u.py) * alpha;
    const z = u.pz + (u.z - u.pz) * alpha;
    const vx = (u.x - u.px) / SIM_DT;
    const vz = (u.z - u.pz) / SIM_DT;
    if (dt > 0) {
      const k = Math.min(1, dt * 10);
      const nvx = v.svx + (vx - v.svx) * k;
      const nvz = v.svz + (vz - v.svz) * k;
      const ax = (nvx - v.svx) / dt;
      const az = (nvz - v.svz) / dt;
      v.svx = nvx;
      v.svz = nvz;
      v.speed = Math.hypot(nvx, nvz);
      v.phase += v.speed * dt * (Math.PI / v.type.stride);
      const want = Math.atan2(u.fx, u.fz);
      let d = want - v.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      v.yaw += d * (1 - Math.exp(-dt * 10));
      const fX = Math.sin(v.yaw);
      const fZ = Math.cos(v.yaw);
      const aF = ax * fX + az * fZ;
      const aL = ax * fZ - az * fX;
      const tX = THREE.MathUtils.clamp(-aF * 0.035, -0.45, 0.45);
      // Rz(+) tips the torso toward -X (model right): inertia lags opposite the acceleration.
      const tZ = THREE.MathUtils.clamp(aL * 0.035, -0.45, 0.45);
      v.vLeanX += ((tX - v.leanX) * 70 - v.vLeanX * 7) * dt;
      v.vLeanZ += ((tZ - v.leanZ) * 70 - v.vLeanZ * 7) * dt;
      v.leanX = THREE.MathUtils.clamp(v.leanX + v.vLeanX * dt, -0.9, 0.9);
      v.leanZ = THREE.MathUtils.clamp(v.leanZ + v.vLeanZ * dt, -0.9, 0.9);
      v.tumble = u.airborne ? Math.min(1.3, v.tumble + dt * 3) : v.tumble * Math.exp(-dt * 6);
    }

    let attack = -1;
    const w = u.weapon;
    const since = (sim.tick - u.lastAttackTick) * SIM_DT;
    if (u.windupLeft >= 0 && w.windup > 0) attack = THREE.MathUtils.clamp(1 - u.windupLeft / w.windup, 0, 1);
    else if (since >= 0 && since < STRIKE_TIME) attack = 1 + since / STRIKE_TIME;
    if (v.type.style === 'breath' && since < 0.45) attack = 1.5;

    const t = v.type;
    t.poser.compute(
      { time: this.time, speed: v.speed, phase: v.phase, attack, airborne: u.airborne, stunned: u.stun > 0, leanX: v.leanX, leanZ: v.leanZ, seed: v.seed, refSpeed: t.refSpeed },
      this.pose,
    );
    this.tmpE.set(-v.tumble, v.yaw, 0, 'YXZ');
    this.tmpQ.setFromEuler(this.tmpE);
    this.rootM.compose(this.tmpP.set(x, y, z), this.tmpQ, this.one);
    for (let k = 0; k < t.template.parts.length; k++) v.world[k].multiplyMatrices(this.rootM, this.pose[k]);
  }

  onHit(e: HitEvent): void {
    const v = this.vis[e.targetId];
    if (!v) return;
    const fX = Math.sin(v.yaw);
    const fZ = Math.cos(v.yaw);
    const fwd = e.dx * fX + e.dz * fZ;
    const left = e.dx * fZ - e.dz * fX;
    const k = Math.min(9, 2.5 + e.damage * 0.06) * (e.blocked ? 0.5 : 1);
    v.vLeanX += fwd * k;
    v.vLeanZ -= left * k;
  }

  onDeath(e: DeathEvent, sim: BattleSim, settings: Settings): void {
    const v = this.vis[e.unitId];
    const u = sim.units[e.unitId];
    if (!v || !u) return;
    const vel = new THREE.Vector3((u.x - u.px) / SIM_DT, u.airborne ? u.vy : 0, (u.z - u.pz) / SIM_DT);
    const impulse = new THREE.Vector3(e.dx * e.force, e.dy * e.force + 1.5, e.dz * e.force);
    if (this.ragdolls && this.ragdolls.active.size < settings.ragdollLimit) {
      v.ragdoll = this.ragdolls.spawn(v.type.template, v.world, vel, impulse);
    } else {
      this.topple(v, u, e);
      v.corpse = true;
    }
    this.corpses.push(v);
  }

  /** Cheap fallback when the ragdoll budget is spent: tip the pose over. */
  private topple(v: UnitVis, u: SimUnit, e: DeathEvent): void {
    const axis = new THREE.Vector3(e.dz, 0, -e.dx);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize();
    const pivot = new THREE.Vector3(u.x, u.y, u.z);
    const m = new THREE.Matrix4()
      .makeTranslation(pivot.x, pivot.y + 0.25, pivot.z)
      .multiply(new THREE.Matrix4().makeRotationAxis(axis, -1.45))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    for (const w of v.world) w.premultiply(m);
  }

  /** Ragdoll lifetimes, ragdoll budget and corpse budget. */
  manage(dt: number, settings: Settings): void {
    const rd = this.ragdolls;
    if (rd) {
      let over = rd.active.size - settings.ragdollLimit;
      for (const v of this.corpses) {
        if (!v.ragdoll) continue;
        if (v.ragdoll.age > RAGDOLL_SECONDS || over > 0) {
          rd.freeze(v.ragdoll, v.world);
          v.ragdoll = null;
          v.corpse = true;
          over--;
        }
      }
    }
    let excess = -settings.corpseLimit;
    for (const c of this.corpses) if (!c.gone) excess++;
    for (const v of this.corpses) {
      if (excess <= 0) break;
      if (v.gone || v.ragdoll) continue;
      v.sink += dt * 0.6;
      if (v.sink > 2.5) v.gone = true;
      excess--;
    }
  }

  /** World position of a named socket on a unit (e.g. dragon "mouth"). */
  socketPosition(unitId: number, name: string, out: THREE.Vector3): boolean {
    const v = this.vis[unitId];
    const s = v?.type.template.sockets[name];
    if (!v || !s) return false;
    out.setFromMatrixPosition(this.rootM.multiplyMatrices(v.world[s.part], s.matrix));
    return true;
  }

  clear(): void {
    for (const t of this.types.values()) {
      for (const m of t.meshes) {
        if (!m) continue;
        this.group.remove(m);
        m.dispose();
      }
    }
    this.types.clear();
    this.vis = [];
    this.corpses = [];
  }
}
