// CPU particle system drawn with a handful of InstancedMeshes (shape × blend mode).
// Additive particles fade by lerping to their end colour (black = invisible); normal
// particles fade by shrinking.
import * as THREE from 'three';
import type { ParticleDef } from '@/shared/schema';

const SHAPES = ['cube', 'tetra', 'sphere'] as const;

function shapeGeometry(shape: (typeof SHAPES)[number]): THREE.BufferGeometry {
  if (shape === 'cube') return new THREE.BoxGeometry(1, 1, 1);
  if (shape === 'tetra') return new THREE.TetrahedronGeometry(0.7);
  return new THREE.IcosahedronGeometry(0.55, 0);
}

export class ParticleSystem {
  readonly group = new THREE.Group();
  private readonly cap: number;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private alive = 0;
  // struct-of-arrays pool
  private readonly p: Float32Array; // x y z
  private readonly v: Float32Array; // vx vy vz
  private readonly r: Float32Array; // rot x y z
  private readonly life: Float32Array; // age, life, size0, size1, spin, gravity, drag
  private readonly col: Float32Array; // r0 g0 b0 r1 g1 b1
  private readonly bucket: Uint8Array;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();
  private readonly tmpC2 = new THREE.Color();

  constructor(capacity = 6000) {
    this.cap = capacity;
    this.p = new Float32Array(capacity * 3);
    this.v = new Float32Array(capacity * 3);
    this.r = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity * 7);
    this.col = new Float32Array(capacity * 6);
    this.bucket = new Uint8Array(capacity);
    this.group.name = 'particles';
    for (const additive of [false, true]) {
      for (const shape of SHAPES) {
        const material = additive
          ? new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
          : new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
        const mesh = new THREE.InstancedMesh(shapeGeometry(shape), material, capacity);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = !additive;
        this.meshes.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  emit(def: ParticleDef, x: number, y: number, z: number, dir?: { x: number; y: number; z: number }, count = def.count, sizeMul = 1): void {
    const bucket = (def.additive ? 3 : 0) + SHAPES.indexOf(def.shape);
    this.tmpC.set(def.colorStart);
    this.tmpC2.set(def.colorEnd);
    for (let n = 0; n < count && this.alive < this.cap; n++) {
      const i = this.alive++;
      const P = i * 3;
      const L = i * 7;
      const C = i * 6;
      const p = this.p;
      p[P] = x + (Math.random() * 2 - 1) * def.emitRadius;
      p[P + 1] = y + (Math.random() * 2 - 1) * def.emitRadius;
      p[P + 2] = z + (Math.random() * 2 - 1) * def.emitRadius;
      const d = this.direction(def, dir);
      const speed = def.speed[0] + Math.random() * (def.speed[1] - def.speed[0]);
      this.v[P] = d.x * speed;
      this.v[P + 1] = d.y * speed;
      this.v[P + 2] = d.z * speed;
      this.r[P] = Math.random() * 6;
      this.r[P + 1] = Math.random() * 6;
      this.r[P + 2] = Math.random() * 6;
      const life = this.life;
      life[L] = 0;
      life[L + 1] = def.lifetime[0] + Math.random() * (def.lifetime[1] - def.lifetime[0]);
      life[L + 2] = def.size[0] * sizeMul;
      life[L + 3] = def.size[1] * sizeMul;
      life[L + 4] = def.spin * (Math.random() * 2 - 1);
      life[L + 5] = def.gravity;
      life[L + 6] = def.drag;
      const col = this.col;
      col[C] = this.tmpC.r;
      col[C + 1] = this.tmpC.g;
      col[C + 2] = this.tmpC.b;
      col[C + 3] = this.tmpC2.r;
      col[C + 4] = this.tmpC2.g;
      col[C + 5] = this.tmpC2.b;
      this.bucket[i] = bucket;
    }
  }

  private direction(def: ParticleDef, dir?: { x: number; y: number; z: number }): THREE.Vector3 {
    const v = this.tmpV;
    const u = randomUnit(v);
    switch (def.direction) {
      case 'sphere':
        return u;
      case 'hemisphere':
        u.y = Math.abs(u.y);
        return u;
      case 'up':
        return v.set(u.x * def.spread, 1, u.z * def.spread).normalize();
      case 'forward': {
        const fx = dir?.x ?? 0;
        const fy = dir?.y ?? 1;
        const fz = dir?.z ?? 0;
        return v.set(fx + u.x * def.spread, fy + u.y * def.spread, fz + u.z * def.spread).normalize();
      }
    }
  }

  update(dt: number): void {
    const counts = new Array(this.meshes.length).fill(0);
    let i = 0;
    while (i < this.alive) {
      const L = i * 7;
      const age = (this.life[L] += dt);
      if (age >= this.life[L + 1]) {
        this.swapRemove(i);
        continue;
      }
      const P = i * 3;
      const drag = Math.max(0, 1 - this.life[L + 6] * dt);
      this.v[P] *= drag;
      this.v[P + 1] = this.v[P + 1] * drag - this.life[L + 5] * dt;
      this.v[P + 2] *= drag;
      this.p[P] += this.v[P] * dt;
      this.p[P + 1] += this.v[P + 1] * dt;
      this.p[P + 2] += this.v[P + 2] * dt;
      const spin = this.life[L + 4] * dt;
      this.r[P] += spin;
      this.r[P + 1] += spin * 0.7;
      const t = age / this.life[L + 1];
      const size = this.life[L + 2] + (this.life[L + 3] - this.life[L + 2]) * t;
      const b = this.bucket[i];
      const mesh = this.meshes[b];
      const slot = counts[b]++;
      this.tmpE.set(this.r[P], this.r[P + 1], this.r[P + 2]);
      this.tmpQ.setFromEuler(this.tmpE);
      this.tmpS.setScalar(Math.max(0.0001, size));
      this.tmpV.set(this.p[P], this.p[P + 1], this.p[P + 2]);
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
      mesh.setMatrixAt(slot, this.tmpM);
      const C = i * 6;
      const arr = mesh.instanceColor!.array as Float32Array;
      arr[slot * 3] = this.col[C] + (this.col[C + 3] - this.col[C]) * t;
      arr[slot * 3 + 1] = this.col[C + 1] + (this.col[C + 4] - this.col[C + 1]) * t;
      arr[slot * 3 + 2] = this.col[C + 2] + (this.col[C + 5] - this.col[C + 2]) * t;
      i++;
    }
    this.meshes.forEach((m, b) => {
      m.count = counts[b];
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor!.needsUpdate = true;
    });
  }

  private swapRemove(i: number): void {
    const last = --this.alive;
    if (i === last) return;
    this.p.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.v.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.r.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.life.copyWithin(i * 7, last * 7, last * 7 + 7);
    this.col.copyWithin(i * 6, last * 6, last * 6 + 6);
    this.bucket[i] = this.bucket[last];
  }

  clear(): void {
    this.alive = 0;
    for (const m of this.meshes) m.count = 0;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}

function randomUnit(v: THREE.Vector3): THREE.Vector3 {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return v.set(r * Math.cos(a), z, r * Math.sin(a));
}
