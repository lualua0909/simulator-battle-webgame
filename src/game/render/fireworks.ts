// Victory fireworks: rockets climb trailing sparks, then burst into a shell or a ring.
// Sparks are unlit and not tone-mapped so the colours stay vivid even against a day sky;
// they fade by shrinking (darkening would read as black specks on a bright sky).
import * as THREE from 'three';
import { commitInstances } from './instancing';

const CAP = 4000;
const SPARK_GRAVITY = 3.2;

interface Rocket {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
  trail: number;
  a: THREE.Color;
  b: THREE.Color;
  ring: boolean;
}

interface Show {
  spots: readonly { x: number; z: number }[];
  palette: THREE.Color[];
  ground: (x: number, z: number) => number;
  left: number;
  next: number;
}

export class Fireworks {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly p = new Float32Array(CAP * 3);
  private readonly v = new Float32Array(CAP * 3);
  private readonly life = new Float32Array(CAP * 4); // age, life, size, drag
  private readonly col = new Float32Array(CAP * 3);
  private count = 0;
  private rockets: Rocket[] = [];
  private show: Show | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly white = new THREE.Color(1, 1, 1);

  constructor() {
    this.group.name = 'fireworks';
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), CAP);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  /** Launch rockets from around `spots` for `seconds`. */
  start(spots: readonly { x: number; z: number }[], palette: readonly string[], ground: (x: number, z: number) => number, seconds: number): void {
    if (spots.length === 0) return;
    this.show = { spots, palette: palette.map((c) => new THREE.Color(c)), ground, left: seconds, next: 0 };
  }

  stop(): void {
    this.show = null;
    this.rockets = [];
    this.count = 0;
    this.mesh.count = 0;
  }

  update(dt: number): void {
    const s = this.show;
    if (s) {
      s.left -= dt;
      s.next -= dt;
      if (s.left <= 0) this.show = null;
      else if (s.next <= 0) {
        s.next = 0.25 + Math.random() * 0.4;
        const salvo = Math.random() < 0.25 ? 3 : 1;
        for (let i = 0; i < salvo; i++) this.launch(s);
      }
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.vy -= 6 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      r.fuse -= dt;
      r.trail -= dt;
      if (r.trail <= 0) {
        r.trail = 0.02;
        this.spark(r.x, r.y, r.z, (Math.random() - 0.5) * 1.5, -2 - Math.random() * 2, (Math.random() - 0.5) * 1.5, 0.45 + Math.random() * 0.3, 0.3, 1.5, 1, 0.82, 0.5);
      }
      if (r.fuse <= 0) {
        this.burst(r);
        this.rockets.splice(i, 1);
      }
    }
    const colors = this.mesh.instanceColor!.array as Float32Array;
    let i = 0;
    while (i < this.count) {
      const L = i * 4;
      const age = (this.life[L] += dt);
      const t = age / this.life[L + 1];
      if (t >= 1) {
        this.remove(i);
        continue;
      }
      const P = i * 3;
      const drag = Math.max(0, 1 - this.life[L + 3] * dt);
      this.v[P] *= drag;
      this.v[P + 1] = this.v[P + 1] * drag - SPARK_GRAVITY * dt;
      this.v[P + 2] *= drag;
      this.p[P] += this.v[P] * dt;
      this.p[P + 1] += this.v[P + 1] * dt;
      this.p[P + 2] += this.v[P + 2] * dt;
      // Shrink out; late sparks twinkle.
      const twinkle = t > 0.55 && Math.random() < 0.3 ? 0.15 : 1;
      const size = this.life[L + 2] * Math.sqrt(1 - t) * twinkle;
      this.m.makeScale(size, size, size).setPosition(this.p[P], this.p[P + 1], this.p[P + 2]);
      this.mesh.setMatrixAt(i, this.m);
      colors[P] = this.col[P];
      colors[P + 1] = this.col[P + 1];
      colors[P + 2] = this.col[P + 2];
      i++;
    }
    commitInstances(this.mesh, this.count);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }

  private launch(s: Show): void {
    const spot = s.spots[Math.floor(Math.random() * s.spots.length)];
    const x = spot.x + (Math.random() - 0.5) * 8;
    const z = spot.z + (Math.random() - 0.5) * 8;
    const pick = () => s.palette[Math.floor(Math.random() * s.palette.length)];
    this.rockets.push({
      x,
      y: s.ground(x, z) + 0.5,
      z,
      vx: (Math.random() - 0.5) * 3,
      vy: 17 + Math.random() * 5,
      vz: (Math.random() - 0.5) * 3,
      fuse: 0.95 + Math.random() * 0.35,
      trail: 0,
      a: pick(),
      b: pick(),
      ring: Math.random() < 0.3,
    });
  }

  private burst(r: Rocket): void {
    this.spark(r.x, r.y, r.z, 0, 0, 0, 0.16, 3.4, 0, 1, 1, 1);
    const n = r.ring ? 64 : 110;
    const speed = 9 + Math.random() * 4;
    const tilt = Math.random() * Math.PI;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    for (let k = 0; k < n; k++) {
      let dx: number;
      let dy: number;
      let dz: number;
      if (r.ring) {
        const a = (k / n) * Math.PI * 2;
        dx = Math.cos(a);
        dy = Math.sin(a) * ct;
        dz = Math.sin(a) * st;
      } else {
        dy = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(1 - dy * dy);
        dx = rr * Math.cos(a);
        dz = rr * Math.sin(a);
      }
      const sp = speed * (r.ring ? 1 : 0.8 + Math.random() * 0.2);
      const c = k % 5 === 0 ? this.white : k % 2 ? r.a : r.b;
      this.spark(r.x, r.y, r.z, dx * sp, dy * sp, dz * sp, 1.3 + Math.random() * 0.8, 0.55, 1.6, c.r, c.g, c.b);
    }
  }

  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, drag: number, r: number, g: number, b: number): void {
    if (this.count >= CAP) return;
    const i = this.count++;
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.life.set([0, life, size, drag], i * 4);
    this.col.set([r, g, b], i * 3);
  }

  private remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.p.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.v.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.life.copyWithin(i * 4, last * 4, last * 4 + 4);
    this.col.copyWithin(i * 3, last * 3, last * 3 + 3);
  }
}
