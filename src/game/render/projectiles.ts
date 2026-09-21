// Flying projectiles (interpolated from the sim) and arrows stuck in the ground.
import * as THREE from 'three';
import type { ConfigBundle, ParticleDef, ProjectileDef } from '@/shared/schema';
import { bakeModel, mergeTemplate } from '../models/bake';
import { createProjectileModel } from '../models/projectiles';
import type { BattleSim } from '../sim/world';
import { commitInstance, commitInstances } from './instancing';
import type { ParticleSystem } from './particles';

const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 });
const FLYING_CAP = 600;
const STUCK_CAP = 500;

interface Kind {
  def: ProjectileDef;
  flying: THREE.InstancedMesh;
  stuck: THREE.InstancedMesh;
  stuckNext: number;
  stuckCount: number;
  /** Flying instances written this frame. */
  count: number;
  trail: ParticleDef | null;
}

export class ProjectileRenderer {
  readonly group = new THREE.Group();
  private readonly kinds = new Map<string, Kind>();
  private readonly trailAcc = new Map<number, number>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly fwd = new THREE.Vector3(0, 0, 1);

  constructor(bundle: ConfigBundle) {
    this.group.name = 'projectiles';
    const particles = new Map(bundle.particles.map((p) => [p.id, p]));
    for (const def of bundle.projectiles) {
      const geo = mergeTemplate(bakeModel(createProjectileModel(def)));
      const flying = new THREE.InstancedMesh(geo, material, FLYING_CAP);
      const stuck = new THREE.InstancedMesh(geo, material, STUCK_CAP);
      for (const mesh of [flying, stuck]) {
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        this.group.add(mesh);
      }
      this.kinds.set(def.id, { def, flying, stuck, stuckNext: 0, stuckCount: 0, count: 0, trail: def.trailParticleId ? particles.get(def.trailParticleId) ?? null : null });
    }
  }

  update(sim: BattleSim, alpha: number, dt: number, particles: ParticleSystem): void {
    for (const kind of this.kinds.values()) kind.count = 0;
    for (const p of sim.projectiles) {
      const kind = this.kinds.get(p.def.id);
      if (!kind || kind.count >= FLYING_CAP) continue;
      const n = kind.count++;
      this.pos.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
      this.dir.set(p.vx, p.vy, p.vz).normalize();
      this.q.setFromUnitVectors(this.fwd, this.dir);
      this.m.compose(this.pos, this.q, this.one);
      kind.flying.setMatrixAt(n, this.m);
      if (kind.trail && dt > 0) {
        const acc = (this.trailAcc.get(p.id) ?? 0) + kind.trail.rate * dt;
        const whole = Math.floor(acc);
        if (whole > 0) particles.emit(kind.trail, this.pos.x, this.pos.y, this.pos.z, undefined, whole);
        this.trailAcc.set(p.id, acc - whole);
      }
    }
    for (const kind of this.kinds.values()) commitInstances(kind.flying, kind.count);
    if (this.trailAcc.size > 2000) this.trailAcc.clear();
  }

  stick(defId: string, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const kind = this.kinds.get(defId);
    if (!kind) return;
    this.dir.set(dx, dy, dz).normalize();
    this.q.setFromUnitVectors(this.fwd, this.dir);
    // bury the tip a little
    this.pos.set(x, y, z).addScaledVector(this.dir, 0.25);
    this.m.compose(this.pos, this.q, this.one);
    kind.stuck.setMatrixAt(kind.stuckNext, this.m);
    commitInstance(kind.stuck, kind.stuckNext);
    kind.stuckNext = (kind.stuckNext + 1) % STUCK_CAP;
    kind.stuckCount = Math.min(STUCK_CAP, kind.stuckCount + 1);
    kind.stuck.count = kind.stuckCount;
  }

  clear(): void {
    for (const k of this.kinds.values()) {
      k.flying.count = 0;
      k.stuck.count = 0;
      k.stuckCount = 0;
      k.stuckNext = 0;
    }
    this.trailAcc.clear();
  }

  dispose(): void {
    for (const k of this.kinds.values()) {
      k.flying.geometry.dispose();
      k.flying.dispose();
      k.stuck.dispose();
    }
  }
}
