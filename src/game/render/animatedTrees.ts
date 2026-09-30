// Animated scenery trees (cay-thong-animation.glb: a 6-bone trunk chain with Sway / Wind /
// Interact_Shake clips). Instances stay in a few InstancedMeshes, one per wind band: each band
// runs its own mixer and its geometry is skinned on the CPU (one ~5k-vertex pass per band), so
// the forest costs a handful of draw calls and works on WebGL and WebGPU alike. Sway plays all
// the time, Wind fades in as gusts sweep across the map band by band, and a tree a unit walks
// into is swapped for a live SkinnedMesh playing Interact_Shake once.
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { AnimatedGlb } from '../models/glbStatic';
import type { BattleSim } from '../sim/world';

/** Wind bands across the map (x); each is one InstancedMesh and one mixer. */
const BANDS = 4;
/** Seconds between gusts, how long one fades in/out and holds, and its delay per band. */
const GUST_PERIOD = 18;
const GUST_RAMP = 1.5;
const GUST_HOLD = 6;
const GUST_SWEEP = 0.9;
/** Sway offset per band so neighbouring bands never move in lockstep. */
const SWAY_OFFSET = 1.3;
/** Simultaneous shaking trees; a touch beyond this is ignored. */
const SHAKE_MAX = 16;
/** A tree rests this long after a shake before it can be shaken again. */
const SHAKE_REST = 0.4;
/** Contact reach beyond the sim's push-out distance (sim: obstacle radius + min(unit radius, 0.95)). */
const UNIT_BODY = 0.95;
const CONTACT_SLACK = 0.3;
const CELL = 4;

export interface TreePlacement {
  x: number;
  z: number;
  radius: number;
  /** Ground position × yaw × scale (the bind-pose recentring is added here). */
  matrix: THREE.Matrix4;
}

interface Tree {
  x: number;
  z: number;
  radius: number;
  matrix: THREE.Matrix4;
  band: Band;
  index: number;
  /** Shaking (or resting after it) until this clock time. */
  busyUntil: number;
}

interface Band {
  mesh: THREE.InstancedMesh;
  mixer: THREE.AnimationMixer;
  bones: THREE.Bone[];
  wind: THREE.AnimationAction | null;
  sway: THREE.AnimationAction | null;
  gustOffset: number;
}

interface Shaker {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction;
  tree: Tree | null;
  left: number;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function clip(clips: readonly THREE.AnimationClip[], re: RegExp): THREE.AnimationClip | undefined {
  return clips.find((c) => re.test(c.name));
}

function findSkinned(root: THREE.Object3D): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | undefined;
  root.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh;
  });
  return found!;
}

/** 0 → 1 → 0 over one gust cycle, smoothed. */
function gust(t: number): number {
  const c = ((t % GUST_PERIOD) + GUST_PERIOD) % GUST_PERIOD;
  const k = c < GUST_RAMP ? c / GUST_RAMP : c < GUST_RAMP + GUST_HOLD ? 1 : c < 2 * GUST_RAMP + GUST_HOLD ? 1 - (c - GUST_RAMP - GUST_HOLD) / GUST_RAMP : 0;
  return k * k * (3 - 2 * k);
}

export class AnimatedTrees {
  readonly group = new THREE.Group();
  private readonly bands: Band[] = [];
  private readonly trees: Tree[] = [];
  private readonly grid = new Map<string, Tree[]>();
  private readonly shakers: Shaker[] = [];
  private readonly shakeClip: THREE.AnimationClip | undefined;
  private readonly skinIndex: THREE.BufferAttribute;
  private readonly skinWeight: THREE.BufferAttribute;
  private readonly rest: Float32Array;
  private readonly boneInverses: THREE.Matrix4[];
  private readonly bind: THREE.Matrix4;
  private readonly bindInverse: THREE.Matrix4;
  private readonly boneMatrices: Float32Array;
  private clock = 0;

  constructor(
    private readonly source: AnimatedGlb,
    private readonly material: THREE.Material,
    placements: readonly TreePlacement[],
    minX: number,
    maxX: number,
    name: string,
  ) {
    const geometry = source.geometry;
    const template = findSkinned(source.scene);
    this.skinIndex = geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
    this.skinWeight = geometry.getAttribute('skinWeight') as THREE.BufferAttribute;
    this.rest = Float32Array.from((geometry.getAttribute('position') as THREE.BufferAttribute).array);
    this.boneInverses = template.skeleton.boneInverses;
    this.bind = template.bindMatrix;
    this.bindInverse = template.bindMatrixInverse;
    this.boneMatrices = new Float32Array(this.boneInverses.length * 16);
    this.shakeClip = clip(source.clips, /shake|interact/i);
    const swayClip = clip(source.clips, /sway/i);
    const windClip = clip(source.clips, /wind/i);

    // Bind pose sits centred on the origin: drop it onto y = 0 like the baked static trees.
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const recentre = new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere!.clone();
    sphere.radius *= 1.3; // swaying tips leave the bind-pose sphere

    const perBand: TreePlacement[][] = Array.from({ length: BANDS }, () => []);
    const span = Math.max(1e-3, maxX - minX);
    for (const p of placements) perBand[Math.min(BANDS - 1, Math.max(0, Math.floor(((p.x - minX) / span) * BANDS)))].push(p);

    perBand.forEach((list, b) => {
      if (list.length === 0) return;
      const root = cloneSkeleton(source.scene);
      const bones = findSkinned(root).skeleton.bones;
      const mixer = new THREE.AnimationMixer(root);
      const sway = swayClip ? mixer.clipAction(swayClip) : null;
      const wind = windClip ? mixer.clipAction(windClip) : null;
      sway?.play();
      wind?.play().setEffectiveWeight(0);
      mixer.update(b * SWAY_OFFSET);
      const g = new THREE.BufferGeometry();
      g.setIndex(geometry.index);
      g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(this.rest), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('normal', geometry.getAttribute('normal'));
      g.setAttribute('color', geometry.getAttribute('color'));
      g.boundingSphere = sphere.clone();
      const mesh = new THREE.InstancedMesh(g, material, list.length);
      const band: Band = { mesh, mixer, bones, sway, wind, gustOffset: b * GUST_SWEEP };
      list.forEach((p, i) => {
        const matrix = p.matrix.clone().multiply(recentre);
        mesh.setMatrixAt(i, matrix);
        const tree: Tree = { x: p.x, z: p.z, radius: p.radius, matrix, band, index: i, busyUntil: 0 };
        this.trees.push(tree);
        const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
        let cell = this.grid.get(key);
        if (!cell) this.grid.set(key, (cell = []));
        cell.push(tree);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.name = `scenery-anim-${name}-${b}`;
      this.bands.push(band);
      this.group.add(mesh);
      this.skin(band);
    });
    this.group.name = `scenery-anim-${name}`;
  }

  /** Advances the wind, starts a shake on trees units walk into, and plays running shakes. */
  update(dt: number, sim: BattleSim | null): void {
    if (dt <= 0) return;
    this.clock += dt;
    for (const band of this.bands) {
      const w = band.wind ? gust(this.clock - band.gustOffset) : 0;
      band.wind?.setEffectiveWeight(w);
      band.sway?.setEffectiveWeight(1 - w);
      band.mixer.update(dt);
      this.skin(band);
    }
    if (sim && this.shakeClip) this.touch(sim);
    for (const s of this.shakers) {
      if (!s.tree) continue;
      s.mixer.update(dt);
      s.left -= dt;
      if (s.left <= 0) this.endShake(s);
    }
  }

  dispose(): void {
    for (const s of this.shakers) if (s.tree) this.endShake(s);
    for (const band of this.bands) {
      band.mixer.stopAllAction();
      band.mesh.geometry.dispose();
      band.mesh.dispose();
    }
    this.group.clear();
  }

  private touch(sim: BattleSim): void {
    for (const u of sim.units) {
      if (!u.alive) continue;
      const mx = u.x - u.px;
      const mz = u.z - u.pz;
      if (mx * mx + mz * mz < 1e-6) continue; // standing still against a trunk is not a shove
      const cx = Math.floor(u.x / CELL);
      const cz = Math.floor(u.z / CELL);
      const reach = Math.min(u.radius, UNIT_BODY) + CONTACT_SLACK;
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          const cell = this.grid.get(`${ix},${iz}`);
          if (!cell) continue;
          for (const t of cell) {
            if (t.busyUntil > this.clock) continue;
            const dx = u.x - t.x;
            const dz = u.z - t.z;
            const r = t.radius + reach;
            if (dx * dx + dz * dz < r * r) this.startShake(t);
          }
        }
      }
    }
  }

  private startShake(tree: Tree): void {
    let s = this.shakers.find((x) => !x.tree);
    if (!s) {
      if (this.shakers.length >= SHAKE_MAX) return;
      const root = cloneSkeleton(this.source.scene);
      const skinned = findSkinned(root);
      skinned.geometry = this.source.geometry;
      skinned.material = this.material;
      skinned.castShadow = true;
      skinned.receiveShadow = true;
      skinned.frustumCulled = false;
      root.matrixAutoUpdate = false;
      const mixer = new THREE.AnimationMixer(root);
      const action = mixer.clipAction(this.shakeClip!);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      s = { root, mixer, action, tree: null, left: 0 };
      this.shakers.push(s);
    }
    s.tree = tree;
    s.left = this.shakeClip!.duration;
    tree.busyUntil = this.clock + s.left + SHAKE_REST;
    s.root.matrix.copy(tree.matrix);
    s.root.matrixWorldNeedsUpdate = true;
    s.action.reset().play();
    s.mixer.update(0);
    this.group.add(s.root);
    tree.band.mesh.setMatrixAt(tree.index, HIDDEN);
    tree.band.mesh.instanceMatrix.needsUpdate = true;
  }

  private endShake(s: Shaker): void {
    const tree = s.tree!;
    tree.band.mesh.setMatrixAt(tree.index, tree.matrix);
    tree.band.mesh.instanceMatrix.needsUpdate = true;
    s.action.stop();
    this.group.remove(s.root);
    s.tree = null;
  }

  /** CPU linear-blend skinning of the band's shared geometry from its bones' current pose. */
  private skin(band: Band): void {
    const root = band.bones[0];
    root.parent?.updateMatrixWorld(true);
    const m = new THREE.Matrix4();
    band.bones.forEach((bone, k) => {
      m.multiplyMatrices(bone.matrixWorld, this.boneInverses[k]).premultiply(this.bindInverse).multiply(this.bind);
      m.toArray(this.boneMatrices, k * 16);
    });
    const bm = this.boneMatrices;
    const rest = this.rest;
    const si = this.skinIndex;
    const sw = this.skinWeight;
    const attr = band.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const out = attr.array as Float32Array;
    for (let i = 0, n = attr.count; i < n; i++) {
      const x = rest[i * 3];
      const y = rest[i * 3 + 1];
      const z = rest[i * 3 + 2];
      let ox = 0;
      let oy = 0;
      let oz = 0;
      for (let j = 0; j < 4; j++) {
        const w = sw.getComponent(i, j);
        if (w === 0) continue;
        const o = si.getComponent(i, j) * 16;
        ox += w * (bm[o] * x + bm[o + 4] * y + bm[o + 8] * z + bm[o + 12]);
        oy += w * (bm[o + 1] * x + bm[o + 5] * y + bm[o + 9] * z + bm[o + 13]);
        oz += w * (bm[o + 2] * x + bm[o + 6] * y + bm[o + 10] * z + bm[o + 14]);
      }
      out[i * 3] = ox;
      out[i * 3 + 1] = oy;
      out[i * 3 + 2] = oz;
    }
    attr.needsUpdate = true;
  }
}
