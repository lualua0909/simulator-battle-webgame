// Small red health bars over enemy soldiers, so the other side is easy to tell apart.
// Each bar is a rounded, top-down gradient pill (dark track + red fill) facing the camera. A pill is
// drawn as three instanced quads — left cap, stretched middle, right cap — so its rounded ends keep
// their shape at any width. Canvas textures keep it renderer-agnostic (WebGL and WebGPU).
import * as THREE from 'three';
import type { Side } from '../sim/terrain';
import type { BattleSim } from '../sim/world';
import { commitInstances } from './instancing';

const BAR_HEIGHT = 0.2;
/** Bars grow with camera distance (up to this factor) so they stay readable zoomed out. */
const MAX_ZOOM_SCALE = 3;
const BAR_GAP = 0.35;
/** Track rim around the fill, as a share of the bar height. */
const RIM = 0.18;
const START_CAPACITY = 256;

/** Texture size: the pill's ends are semicircles of radius TEX_H / 2 (u 0..CAP_U and 1−CAP_U..1). */
const TEX_W = 256;
const TEX_H = 64;
const CAP_U = TEX_H / 2 / TEX_W;

function pillTexture(stops: [number, string][], shine: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const g = canvas.getContext('2d')!;
  const r = TEX_H / 2;
  g.beginPath();
  g.roundRect(0, 0, TEX_W, TEX_H, r);
  const grad = g.createLinearGradient(0, 0, 0, TEX_H);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fill();
  if (shine) {
    // Glossy band along the top.
    const top = TEX_H * 0.1;
    const h = TEX_H * 0.32;
    g.beginPath();
    g.roundRect(r * 0.5, top, TEX_W - r, h, h / 2);
    const s = g.createLinearGradient(0, top, 0, top + h);
    s.addColorStop(0, 'rgba(255,255,255,0.55)');
    s.addColorStop(1, 'rgba(255,255,255,0.05)');
    g.fillStyle = s;
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Unit quad showing texture columns u0..u1. */
function sliceGeometry(u0: number, u1: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(1, 1);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0));
  return geo;
}

const SLICES = [sliceGeometry(0, CAP_U), sliceGeometry(0.45, 0.55), sliceGeometry(1 - CAP_U, 1)];

/** Left cap, middle, right cap. */
type Pill = THREE.InstancedMesh[];

export class HealthBars {
  readonly group = new THREE.Group();
  private readonly trackMat: THREE.MeshBasicMaterial;
  private readonly fillMat: THREE.MeshBasicMaterial;
  private track: Pill = [];
  private fill: Pill = [];
  private capacity = 0;
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly eye = new THREE.Vector3();

  constructor() {
    this.group.name = 'healthBars';
    const opts = { fog: false, toneMapped: false, depthTest: false, depthWrite: false, transparent: true };
    this.trackMat = new THREE.MeshBasicMaterial({ ...opts, map: pillTexture([[0, '#2a0f10'], [1, '#0c0405']], false) });
    this.fillMat = new THREE.MeshBasicMaterial({ ...opts, map: pillTexture([[0, '#ff8a7a'], [0.45, '#e8262b'], [1, '#8a0c12']], true) });
    this.grow(START_CAPACITY);
  }

  /** Bars over living, non-building units that are not on `own` side (none for a hidden side). */
  update(sim: BattleSim, alpha: number, own: Side, hidden: Side | null, camera: THREE.Camera): void {
    if (sim.units.length > this.capacity) this.grow(sim.units.length * 2);
    camera.getWorldQuaternion(this.q);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
    camera.getWorldPosition(this.eye);
    let n = 0;
    for (const u of sim.units) {
      if (!u.alive || u.structure || u.side === own || u.side === hidden) continue;
      const ratio = Math.max(0, Math.min(1, u.hp / u.def.hp));
      const x = u.px + (u.x - u.px) * alpha;
      const y = u.py + (u.y - u.py) * alpha + u.def.height + BAR_GAP;
      const z = u.pz + (u.z - u.pz) * alpha;
      const zoom = Math.min(MAX_ZOOM_SCALE, Math.max(1, this.eye.distanceTo(this.c.set(x, y, z)) / 20));
      const width = Math.min(2.5, Math.max(0.9, u.def.radius * 1.6)) * zoom;
      const height = BAR_HEIGHT * zoom;
      const rim = height * RIM;
      this.place(this.track, n, width, height, 0);
      // Fill sits inside the rim and shrinks toward the left end.
      const inner = width - rim * 2;
      this.place(this.fill, n, inner * ratio, height - rim * 2, -(inner * (1 - ratio)) / 2);
      n++;
    }
    for (const mesh of [...this.track, ...this.fill]) commitInstances(mesh, n);
  }

  clear(): void {
    for (const mesh of [...this.track, ...this.fill]) mesh.count = 0;
  }

  /** Writes a pill of `width` × `height`, centred `shift` along the camera's right from `this.c`, into slot n. */
  private place(pill: Pill, n: number, width: number, height: number, shift: number): void {
    const cap = Math.max(0.0001, Math.min(height, width) / 2);
    const widths = [cap, Math.max(0.0001, width - cap * 2), cap];
    const offsets = [-(width - cap) / 2, 0, (width - cap) / 2];
    for (let k = 0; k < 3; k++) {
      this.p.copy(this.c).addScaledVector(this.right, shift + offsets[k]);
      this.m.compose(this.p, this.q, this.s.set(widths[k], height, 1));
      pill[k].setMatrixAt(n, this.m);
    }
  }

  private grow(capacity: number): void {
    this.capacity = capacity;
    for (const mesh of [...this.track, ...this.fill]) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    const pill = (mat: THREE.Material, order: number): Pill =>
      SLICES.map((geo) => {
        const m = new THREE.InstancedMesh(geo, mat, capacity);
        m.count = 0;
        m.frustumCulled = false;
        m.renderOrder = order;
        this.group.add(m);
        return m;
      });
    this.track = pill(this.trackMat, 10);
    this.fill = pill(this.fillMat, 11);
  }
}
