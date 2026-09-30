// Map weather, purely cosmetic (no effect on the sim).
// snow: one instanced draw of tiny unlit flakes drifting down and wrapping back to the top.
// sand: now and then one or two dust devils (the whirlwind skill's funnel) wander across the field.
import * as THREE from 'three';
import type { ParticleDef } from '@/shared/schema';
import { bakeModel } from '../models/bake';
import { createTornadoModel } from '../models/effects';
import type { Terrain } from '../sim/terrain';
import type { ParticleSystem } from './particles';

export type WeatherKind = 'snow' | 'sand';

export interface Weather {
  readonly object: THREE.Object3D;
  update(dt: number, time: number): void;
  dispose(): void;
}

export function createWeather(kind: WeatherKind, terrain: Terrain, particles: ParticleSystem, dust: ParticleDef | null): Weather {
  return kind === 'snow' ? new Snowfall(terrain) : new DustDevils(terrain, particles, dust);
}

// ---------------------------------------------------------------- snow

const FLAKES = 900;
const FALL_SPEED = 1.1;

class Snowfall implements Weather {
  readonly object: THREE.InstancedMesh;
  private readonly base = new Float32Array(FLAKES * 3); // x, z, sway phase
  private readonly y = new Float32Array(FLAKES);
  private readonly speed = new Float32Array(FLAKES);
  private readonly top: number;
  private readonly bottom = -2;

  constructor(terrain: Terrain) {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false });
    this.object = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 0), mat, FLAKES);
    this.object.name = 'weather-snow';
    this.object.frustumCulled = false;
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.top = terrain.maxHeight + 22;
    const h = terrain.half;
    const m = new THREE.Matrix4();
    for (let i = 0; i < FLAKES; i++) {
      this.base[i * 3] = (Math.random() * 2 - 1) * h;
      this.base[i * 3 + 1] = (Math.random() * 2 - 1) * h;
      this.base[i * 3 + 2] = Math.random() * Math.PI * 2;
      this.y[i] = this.bottom + Math.random() * (this.top - this.bottom);
      this.speed[i] = FALL_SPEED * (0.7 + Math.random() * 0.6);
      const s = 0.6 + Math.random() * 0.8;
      m.makeScale(s, s, s);
      this.object.setMatrixAt(i, m);
    }
  }

  update(dt: number, time: number): void {
    const e = this.object.instanceMatrix.array as Float32Array;
    const span = this.top - this.bottom;
    for (let i = 0; i < FLAKES; i++) {
      let y = this.y[i] - this.speed[i] * dt;
      if (y < this.bottom) y += span;
      this.y[i] = y;
      const phase = this.base[i * 3 + 2];
      const o = i * 16;
      e[o + 12] = this.base[i * 3] + Math.sin(time * 0.6 + phase) * 0.6;
      e[o + 13] = y;
      e[o + 14] = this.base[i * 3 + 1] + Math.cos(time * 0.5 + phase) * 0.6;
    }
    this.object.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    this.object.dispose();
  }
}

// ---------------------------------------------------------------- sand

const DEVIL_RADIUS = 2.2;
const DEVIL_SPEED = 3.5;
const SAND = '#d8bd86';

interface Devil {
  group: THREE.Group;
  bands: THREE.Mesh[];
  debris: THREE.Mesh | null;
  x: number;
  z: number;
  dx: number;
  dz: number;
  age: number;
  life: number;
  phase: number;
  dustAcc: number;
}

class DustDevils implements Weather {
  readonly object = new THREE.Group();
  private readonly parts: { geometry: THREE.BufferGeometry; position: THREE.Vector3; name: string }[] = [];
  private readonly material: THREE.Material;
  private readonly devils: Devil[] = [];
  private wait = 4 + Math.random() * 6;

  constructor(
    private readonly terrain: Terrain,
    private readonly particles: ParticleSystem,
    private readonly dust: ParticleDef | null,
  ) {
    this.object.name = 'weather-sand';
    const template = bakeModel(createTornadoModel({ radius: DEVIL_RADIUS, height: 2.5 + DEVIL_RADIUS * 2.2, color: SAND, seed: 23 }));
    for (const p of template.parts) {
      if (p.geometry) this.parts.push({ geometry: p.geometry, position: new THREE.Vector3().setFromMatrixPosition(p.rest), name: p.local });
    }
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, roughness: 1 });
  }

  update(dt: number, time: number): void {
    this.wait -= dt;
    if (this.wait <= 0 && this.devils.length === 0) {
      const count = Math.random() < 0.4 ? 2 : 1;
      for (let i = 0; i < count; i++) this.spawn();
      this.wait = 12 + Math.random() * 18;
    }
    for (let i = this.devils.length - 1; i >= 0; i--) {
      const d = this.devils[i];
      d.age += dt;
      if (d.age >= d.life) {
        this.object.remove(d.group);
        this.devils.splice(i, 1);
        continue;
      }
      // Wander: the heading sways so the path curves instead of running on a ruler.
      const sway = Math.sin(time * 0.8 + d.phase) * 0.6;
      d.x += (d.dx - d.dz * sway) * DEVIL_SPEED * dt;
      d.z += (d.dz + d.dx * sway) * DEVIL_SPEED * dt;
      d.group.position.set(d.x, this.terrain.height(d.x, d.z), d.z);
      // Grow in, fade out.
      const k = Math.max(0, Math.min(1, d.age / 1.2, (d.life - d.age) / 1.5));
      const s = k * k * (3 - 2 * k);
      d.group.scale.set(s, 0.3 + 0.7 * s, s);
      d.bands.forEach((band, j) => {
        band.rotation.y = -time * (5.2 - j * 0.45) + j;
        band.position.x = Math.sin(time * 1.9 + j * 0.7) * j * 0.05 * DEVIL_RADIUS;
        band.position.z = Math.cos(time * 1.5 + j * 0.9) * j * 0.04 * DEVIL_RADIUS;
      });
      if (d.debris) d.debris.rotation.y = -time * 3.6;
      if (this.dust && dt > 0 && s > 0.5) {
        d.dustAcc += this.dust.rate * dt * 0.5;
        const whole = Math.floor(d.dustAcc);
        d.dustAcc -= whole;
        const p = d.group.position;
        for (let n = 0; n < whole; n++) {
          const a = Math.random() * Math.PI * 2;
          const rr = DEVIL_RADIUS * (0.3 + Math.random() * 0.8);
          this.particles.emit(this.dust, p.x + Math.cos(a) * rr, p.y + 0.2, p.z + Math.sin(a) * rr, { x: -Math.sin(a), y: 0.6, z: Math.cos(a) }, 1);
        }
      }
    }
  }

  /** Enters near one z edge (across the armies' line of attack) and crosses toward the other. */
  private spawn(): void {
    const h = this.terrain.half;
    const from = Math.random() < 0.5 ? -1 : 1;
    const a = (Math.random() - 0.5) * 0.8;
    const dx = Math.sin(a);
    const dz = -from * Math.cos(a);
    const group = new THREE.Group();
    const bands: THREE.Mesh[] = [];
    let debris: THREE.Mesh | null = null;
    for (const p of this.parts) {
      const mesh = new THREE.Mesh(p.geometry, this.material);
      mesh.frustumCulled = false;
      mesh.position.copy(p.position);
      mesh.renderOrder = 2;
      group.add(mesh);
      if (p.name === 'debris') debris = mesh;
      else if (p.name.startsWith('band')) bands.push(mesh);
    }
    group.scale.setScalar(0);
    this.object.add(group);
    const x = (Math.random() * 2 - 1) * h * 0.6;
    this.devils.push({ group, bands, debris, x, z: from * h * 0.85, dx, dz, age: 0, life: (h * 1.7) / DEVIL_SPEED, phase: Math.random() * 10, dustAcc: 0 });
  }

  dispose(): void {
    for (const p of this.parts) p.geometry.dispose();
    this.material.dispose();
  }
}
