// Light snowfall over the whole map: one instanced draw of tiny unlit flakes drifting down
// and wrapping back to the top. Only the translation column of each matrix is rewritten per frame.
import * as THREE from 'three';
import type { Terrain } from '@/game/sim/terrain';

const COUNT = 900;
const FALL_SPEED = 1.1;

export class Snowfall {
  readonly mesh: THREE.InstancedMesh;
  private readonly base = new Float32Array(COUNT * 3); // x, z, sway phase
  private readonly y = new Float32Array(COUNT);
  private readonly speed = new Float32Array(COUNT);
  private readonly top: number;
  private readonly bottom: number;

  constructor(terrain: Terrain) {
    const flake = new THREE.IcosahedronGeometry(0.07, 0);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(flake, mat, COUNT);
    this.mesh.name = 'snowfall';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bottom = -2;
    this.top = terrain.maxHeight + 22;
    const h = terrain.half;
    const m = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) {
      this.base[i * 3] = (Math.random() * 2 - 1) * h;
      this.base[i * 3 + 1] = (Math.random() * 2 - 1) * h;
      this.base[i * 3 + 2] = Math.random() * Math.PI * 2;
      this.y[i] = this.bottom + Math.random() * (this.top - this.bottom);
      this.speed[i] = FALL_SPEED * (0.7 + Math.random() * 0.6);
      const s = 0.6 + Math.random() * 0.8;
      m.makeScale(s, s, s);
      this.mesh.setMatrixAt(i, m);
    }
  }

  update(dt: number, time: number): void {
    const e = this.mesh.instanceMatrix.array as Float32Array;
    const span = this.top - this.bottom;
    for (let i = 0; i < COUNT; i++) {
      let y = this.y[i] - this.speed[i] * dt;
      if (y < this.bottom) y += span;
      this.y[i] = y;
      const phase = this.base[i * 3 + 2];
      const o = i * 16;
      e[o + 12] = this.base[i * 3] + Math.sin(time * 0.6 + phase) * 0.6;
      e[o + 13] = y;
      e[o + 14] = this.base[i * 3 + 1] + Math.cos(time * 0.5 + phase) * 0.6;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
