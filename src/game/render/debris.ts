// Cosmetic stone and timber chunks thrown out when walls crumble and buildings collapse.
// Simple rigid-body-ish motion: gravity, tumbling, terrain bounce with friction, then
// the chunk settles, lingers and sinks away. Never feeds the simulation.
import * as THREE from 'three';
import type { Terrain } from '../sim/terrain';
import { commitInstances } from './instancing';

const CAP = 1400;
const LINGER = 5;
const SINK = 1.2;

export interface DebrisBurst {
  /** Volume the chunks start inside (centre + half extents). */
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  count: number;
  colors: readonly string[];
  /** Outward push direction (planar) and strength. */
  dx?: number;
  dz?: number;
  force?: number;
  /** Chunk size range (m). */
  size?: [number, number];
  /** Delay before the chunks break loose (s). */
  delay?: number;
}

export class DebrisSystem {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private terrain: Terrain | null = null;
  private n = 0;
  private readonly pos = new Float32Array(CAP * 3);
  private readonly vel = new Float32Array(CAP * 3);
  private readonly rot = new Float32Array(CAP * 3);
  private readonly spin = new Float32Array(CAP * 3);
  /** age, size, rest time, delay */
  private readonly life = new Float32Array(CAP * 4);
  private readonly color = new Float32Array(CAP * 3);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor() {
    this.group.name = 'debris';
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    geo.scale(1, 0.7, 0.85);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.95 }), CAP);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
  }

  setTerrain(terrain: Terrain | null): void {
    this.terrain = terrain;
  }

  burst(b: DebrisBurst): void {
    const [s0, s1] = b.size ?? [0.18, 0.55];
    const force = b.force ?? 4;
    for (let k = 0; k < b.count; k++) {
      // A full pool recycles the oldest chunk.
      const i = this.n < CAP ? this.n++ : Math.floor(Math.random() * CAP);
      const P = i * 3;
      const ox = (Math.random() * 2 - 1) * b.hx;
      const oy = (Math.random() * 2 - 1) * b.hy;
      const oz = (Math.random() * 2 - 1) * b.hz;
      this.pos[P] = b.x + ox;
      this.pos[P + 1] = b.y + oy;
      this.pos[P + 2] = b.z + oz;
      // Outward from the centre, biased along the push direction, a little upward.
      const out = 0.6 + Math.random() * 0.8;
      this.vel[P] = (ox / Math.max(0.3, b.hx)) * force * 0.5 * out + (b.dx ?? 0) * force * out;
      this.vel[P + 1] = (0.5 + Math.random()) * force * 0.55 + (oy / Math.max(0.3, b.hy)) * 0.8;
      this.vel[P + 2] = (oz / Math.max(0.3, b.hz)) * force * 0.5 * out + (b.dz ?? 0) * force * out;
      for (let a = 0; a < 3; a++) {
        this.rot[P + a] = Math.random() * 6.28;
        this.spin[P + a] = (Math.random() * 2 - 1) * 9;
      }
      const L = i * 4;
      this.life[L] = 0;
      this.life[L + 1] = s0 + Math.random() * (s1 - s0);
      this.life[L + 2] = -1;
      this.life[L + 3] = (b.delay ?? 0) + Math.random() * 0.12;
      this.c.set(b.colors[Math.floor(Math.random() * b.colors.length)]).multiplyScalar(0.8 + Math.random() * 0.35);
      this.color[P] = this.c.r;
      this.color[P + 1] = this.c.g;
      this.color[P + 2] = this.c.b;
    }
  }

  update(dt: number): void {
    const t = this.terrain;
    if (this.n === 0 || !t) {
      this.mesh.count = 0;
      return;
    }
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const P = i * 3;
      const L = i * 4;
      this.life[L] += dt;
      const age = this.life[L];
      const delay = this.life[L + 3];
      const size = this.life[L + 1];
      let rest = this.life[L + 2];
      if (age >= delay) {
        if (rest < 0) {
          this.vel[P + 1] -= 16 * dt;
          this.pos[P] += this.vel[P] * dt;
          this.pos[P + 1] += this.vel[P + 1] * dt;
          this.pos[P + 2] += this.vel[P + 2] * dt;
          for (let a = 0; a < 3; a++) this.rot[P + a] += this.spin[P + a] * dt;
          const ground = t.height(this.pos[P], this.pos[P + 2]) + size * 0.3;
          if (this.pos[P + 1] < ground) {
            this.pos[P + 1] = ground;
            if (this.vel[P + 1] < -2.5) {
              this.vel[P + 1] *= -0.3;
              this.vel[P] *= 0.55;
              this.vel[P + 2] *= 0.55;
              for (let a = 0; a < 3; a++) this.spin[P + a] *= 0.5;
            } else {
              this.life[L + 2] = rest = age;
            }
          }
        }
      }
      const sink = rest >= 0 ? Math.max(0, age - rest - LINGER) / SINK : 0;
      if (sink >= 1) continue;
      // Compact alive chunks to the front of the pool.
      if (w !== i) this.move(i, w);
      const W = w * 3;
      this.e.set(this.rot[W], this.rot[W + 1], this.rot[W + 2]);
      this.q.setFromEuler(this.e);
      this.p.set(this.pos[W], this.pos[W + 1] - sink * size, this.pos[W + 2]);
      this.s.setScalar(size * (1 - sink * 0.5));
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(w, this.m);
      this.c.setRGB(this.color[W], this.color[W + 1], this.color[W + 2]);
      this.mesh.setColorAt(w, this.c);
      w++;
    }
    this.n = w;
    commitInstances(this.mesh, w);
  }

  private move(from: number, to: number): void {
    this.pos.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.vel.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.rot.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.spin.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.color.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.life.copyWithin(to * 4, from * 4, from * 4 + 4);
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
