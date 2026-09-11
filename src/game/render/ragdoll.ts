// Cosmetic ragdolls (Rapier): each baked part becomes a box body, pivots become
// spherical joints, held weapons fall free. Never feeds back into the simulation.
import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { ModelTemplate } from '../models/bake';
import type { Terrain } from '../sim/terrain';

type Rapier = typeof RAPIER_NS;
type Body = RAPIER_NS.RigidBody;

let loading: Promise<Rapier> | null = null;

export function loadRapier(): Promise<Rapier> {
  loading ??= import('@dimforge/rapier3d-compat').then(async (mod) => {
    const R = ((mod as unknown as { default?: Rapier }).default ?? mod) as Rapier;
    await R.init();
    return R;
  });
  return loading;
}

// membership << 16 | filter: ground and ragdoll parts only touch each other.
const GROUND_GROUPS = (0x0001 << 16) | 0x0002;
const PART_GROUPS = (0x0002 << 16) | 0x0001;

export interface Ragdoll {
  template: ModelTemplate;
  bodies: (Body | null)[];
  owner: number[];
  rel: THREE.Matrix4[];
  hidden: boolean[];
  age: number;
}

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);

export class RagdollWorld {
  private readonly world: RAPIER_NS.World;
  readonly active = new Set<Ragdoll>();

  static async create(terrain: Terrain): Promise<RagdollWorld> {
    return new RagdollWorld(await loadRapier(), terrain);
  }

  private constructor(
    private readonly R: Rapier,
    terrain: Terrain,
  ) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    const step = 2;
    const n = Math.ceil(terrain.size / step) + 1;
    const verts = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -terrain.half + i * step;
        const z = -terrain.half + j * step;
        verts.set([x, terrain.height(x, z), z], (j * n + i) * 3);
      }
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], k);
        k += 6;
      }
    }
    const ground = R.ColliderDesc.trimesh(verts, idx).setCollisionGroups(GROUND_GROUPS).setFriction(0.9);
    this.world.createCollider(ground);
  }

  /** `pose` = current world matrices of every part. */
  spawn(template: ModelTemplate, pose: THREE.Matrix4[], vel: THREE.Vector3, impulse: THREE.Vector3): Ragdoll {
    const R = this.R;
    const parts = template.parts;
    const bodies: (Body | null)[] = new Array(parts.length).fill(null);
    const hidden = parts.map((_, i) => {
      pose[i].decompose(tmpPos, tmpQuat, tmpScale);
      return tmpScale.x < 0.01;
    });
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.geometry || !p.box || hidden[i]) continue;
      pose[i].decompose(tmpPos, tmpQuat, tmpScale);
      const spin = p.detachable ? 6 : 2.5;
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(tmpPos.x, tmpPos.y, tmpPos.z)
        .setRotation({ x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w })
        .setLinearDamping(0.15)
        .setAngularDamping(1.2)
        .setLinvel(vel.x + impulse.x * (0.6 + Math.random() * 0.8), vel.y + impulse.y * (0.6 + Math.random() * 0.8), vel.z + impulse.z * (0.6 + Math.random() * 0.8))
        .setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin });
      const body = this.world.createRigidBody(desc);
      const size = p.box.getSize(new THREE.Vector3());
      const center = p.box.getCenter(new THREE.Vector3());
      const collider = R.ColliderDesc.cuboid(Math.max(0.04, size.x / 2), Math.max(0.04, size.y / 2), Math.max(0.04, size.z / 2))
        .setTranslation(center.x, center.y, center.z)
        .setCollisionGroups(PART_GROUPS)
        .setFriction(0.8)
        .setRestitution(0.1);
      this.world.createCollider(collider, body);
      bodies[i] = body;
    }
    const firstBody = bodies.findIndex((b) => b !== null);
    const owner = parts.map((_, i) => {
      if (bodies[i]) return i;
      let a = parts[i].parent;
      while (a >= 0 && !bodies[a]) a = parts[a].parent;
      return a >= 0 ? a : firstBody;
    });
    const rel = parts.map((p, i) => {
      const o = owner[i];
      return o >= 0 && o !== i ? parts[o].rest.clone().invert().multiply(p.rest) : new THREE.Matrix4();
    });
    // joints: each bodied part hangs from its nearest bodied ancestor at its pivot
    const inv = new THREE.Matrix4();
    for (let i = 0; i < parts.length; i++) {
      const body = bodies[i];
      if (!body || parts[i].detachable) continue;
      let a = parts[i].parent;
      while (a >= 0 && !bodies[a]) a = parts[a].parent;
      if (a < 0) continue;
      inv.copy(pose[a]).invert().multiply(pose[i]);
      tmpPos.setFromMatrixPosition(inv);
      const joint = R.JointData.spherical({ x: tmpPos.x, y: tmpPos.y, z: tmpPos.z }, { x: 0, y: 0, z: 0 });
      this.world.createImpulseJoint(joint, bodies[a]!, body, true);
    }
    const ragdoll: Ragdoll = { template, bodies, owner, rel, hidden, age: 0 };
    this.active.add(ragdoll);
    return ragdoll;
  }

  step(dt: number): void {
    if (this.active.size === 0 || dt <= 0) return;
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
    for (const r of this.active) r.age += dt;
  }

  read(r: Ragdoll, out: THREE.Matrix4[]): void {
    const parts = r.template.parts;
    for (let i = 0; i < parts.length; i++) {
      const body = r.bodies[i];
      if (body) {
        const t = body.translation();
        const q = body.rotation();
        out[i].compose(tmpPos.set(t.x, t.y, t.z), tmpQuat.set(q.x, q.y, q.z, q.w), one);
      } else if (r.owner[i] >= 0 && r.owner[i] < i) {
        out[i].multiplyMatrices(out[r.owner[i]], r.rel[i]);
      } else if (r.owner[i] >= 0) {
        const b = r.bodies[r.owner[i]]!;
        const t = b.translation();
        const q = b.rotation();
        out[i].compose(tmpPos.set(t.x, t.y, t.z), tmpQuat.set(q.x, q.y, q.z, q.w), one).multiply(r.rel[i]);
      }
      if (r.hidden[i]) out[i].scale(tmpScale.setScalar(0.0001));
    }
  }

  /** Final pose into `out`, then the bodies are removed. */
  freeze(r: Ragdoll, out: THREE.Matrix4[]): void {
    this.read(r, out);
    for (const b of r.bodies) if (b) this.world.removeRigidBody(b);
    r.bodies.fill(null);
    this.active.delete(r);
  }

  dispose(): void {
    this.active.clear();
    this.world.free();
  }
}
