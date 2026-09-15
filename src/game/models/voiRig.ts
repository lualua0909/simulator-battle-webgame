// Rigid rig for the committed voi.glb (Voi ma mút / Chiến tượng): the file is one static
// mesh, so it is cut per-triangle into the part names the quadruped poser already drives
// (body, head, trunk1→2→3, legFL/FR/BL/BR, shinFL/…, tail). Ears stay fused to the head:
// a flap hinge on the head silhouette would open see-through cracks. Cuts sit under
// overhangs or inside the torso mass where possible, so swinging parts clip through solid
// geometry (like every procedural preset) instead of opening sky slits.
//
// All numbers below are authored voi.glb metres (Y up, +Z forward, height ≈ 8.29): measured
// from the file's own vertices (ankle footprints, trunk centreline, ear/tail bounds), not
// guessed. A different elephant file with other proportions needs remeasuring.
import * as THREE from 'three';
import { mesh, modelRoot, part, socket, type Vec3 } from './common';

type PartKey =
  | 'body'
  | 'head'
  | 'trunk1'
  | 'trunk2'
  | 'trunk3'
  | 'legFL'
  | 'legFR'
  | 'legBL'
  | 'legBR'
  | 'shinFL'
  | 'shinFR'
  | 'shinBL'
  | 'shinBR'
  | 'tail';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** World-space pivots each part rotates about. */
const PIVOT: Record<PartKey, Vec3> = {
  body: [0, 4.145, 0],
  head: [0, 6.2, 2.4],
  trunk1: [0, 6.4, 4.1],
  trunk2: [0, 3.8, 4.9],
  trunk3: [0, 1.6, 5.0],
  legFL: [1.2, 4.7, 1.64],
  legFR: [-1.2, 4.7, 1.64],
  legBL: [1.5, 4.5, -3.77],
  legBR: [-1.5, 4.5, -3.77],
  shinFL: [1.2, 2.5, 1.64],
  shinFR: [-1.2, 2.5, 1.64],
  shinBL: [1.5, 2.5, -3.77],
  shinBR: [-1.5, 2.5, -3.77],
  tail: [0, 6.3, -5.0],
};

const PARENT: Record<Exclude<PartKey, 'body'>, PartKey> = {
  head: 'body',
  trunk1: 'head',
  trunk2: 'trunk1',
  trunk3: 'trunk2',
  legFL: 'body',
  legFR: 'body',
  legBL: 'body',
  legBR: 'body',
  shinFL: 'legFL',
  shinFR: 'legFR',
  shinBL: 'legBL',
  shinBR: 'legBR',
  tail: 'body',
};

// Leg columns (tight elliptical footprint around the ankle centres, tops buried in the
// torso; z-guards keep chest-front/rump silhouette faces on the static body).
interface LegCut {
  leg: PartKey;
  shin: PartKey;
  x: number;
  z: number;
  rx: number;
  rz: number;
  top: number;
  zMax?: number;
  zMin?: number;
}
const LEGS: LegCut[] = [
  { leg: 'legFL', shin: 'shinFL', x: 1.2, z: 1.64, rx: 0.7, rz: 1.05, top: 5.2, zMax: 2.75 },
  { leg: 'legFR', shin: 'shinFR', x: -1.2, z: 1.64, rx: 0.7, rz: 1.05, top: 5.2, zMax: 2.75 },
  { leg: 'legBL', shin: 'shinBL', x: 1.5, z: -3.77, rx: 0.75, rz: 1.05, top: 5.0, zMin: -4.65 },
  { leg: 'legBR', shin: 'shinBR', x: -1.5, z: -3.77, rx: 0.75, rz: 1.05, top: 5.0, zMin: -4.65 },
];
const SHIN_Y = 2.6;

/** Triangle centroid → owning part. Order matters: thin protrusions first, torso last. */
function classify(x: number, y: number, z: number): PartKey {
  const ax = Math.abs(x);
  if (z < -4.9 && ax < 0.8) return 'tail';
  if (z > 3.3 && ax < 1.5 && y < 7.4) {
    if (y < 2.2) return 'trunk3';
    if (y < 4.6) return 'trunk2';
    return 'trunk1';
  }
  for (const L of LEGS) {
    if (L.zMax !== undefined && z > L.zMax) continue;
    if (L.zMin !== undefined && z < L.zMin) continue;
    const dx = (x - L.x) / L.rx;
    const dz = (z - L.z) / L.rz;
    if (dx * dx + dz * dz < 1 && y < L.top) return y < SHIN_Y ? L.shin : L.leg;
  }
  if (z > 1.6 && y > 4.6 && ax < 2.7) return 'head';
  return 'body';
}

/**
 * Splits a baked (non-indexed, vertex-coloured) voi geometry into the rig hierarchy.
 * `height` is the grounded baked height; the saddle socket keeps its measured seat.
 */
export function buildVoiRig(baked: THREE.BufferGeometry, height: number): THREE.Group {
  const H = Math.max(0.01, height);
  PIVOT.body = [0, H * 0.5, 0];
  const src = baked.index ? baked.toNonIndexed() : baked;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const col = src.getAttribute('color') as THREE.BufferAttribute | undefined;
  const triCount = Math.floor(pos.count / 3);
  const buckets = new Map<PartKey, number[]>();
  const cx = [0, 0, 0];
  for (let t = 0; t < triCount; t++) {
    cx[0] = cx[1] = cx[2] = 0;
    for (let k = 0; k < 3; k++) {
      cx[0] += pos.getX(t * 3 + k);
      cx[1] += pos.getY(t * 3 + k);
      cx[2] += pos.getZ(t * 3 + k);
    }
    const key = classify(cx[0] / 3, cx[1] / 3, cx[2] / 3);
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(t);
  }
  const partGeo = (key: PartKey): THREE.BufferGeometry | null => {
    const list = buckets.get(key);
    if (!list?.length) return null;
    const n = list.length * 9;
    const p = new Float32Array(n);
    const c = new Float32Array(n);
    const pa = pos.array as Float32Array;
    const ca = (col?.array ?? new Float32Array(0)) as Float32Array;
    let o = 0;
    for (const t of list) {
      p.set(pa.subarray(t * 9, t * 9 + 9), o);
      if (ca.length) c.set(ca.subarray(t * 9, t * 9 + 9), o);
      else c.fill(1, o, o + 9);
      o += 9;
    }
    // Express in the pivot's frame (bakeModel resolves the rest via matrixWorld).
    const pv = PIVOT[key];
    for (let i = 0; i < p.length; i += 3) {
      p[i] -= pv[0];
      p[i + 1] -= pv[1];
      p[i + 2] -= pv[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    // Flat look like the rest of the pipeline (baked normals are pre-cut anyway).
    const flat = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(p.slice(), 3));
    flat.computeVertexNormals();
    g.setAttribute('normal', flat.getAttribute('normal'));
    return g;
  };

  const root = modelRoot('glb', 'quadruped');
  const nodes = new Map<PartKey, THREE.Group>();
  const nodeOf = (key: PartKey): THREE.Group => {
    let node = nodes.get(key);
    if (node) return node;
    node = key === 'body' ? part('body', PIVOT.body) : part(key, sub(PIVOT[key], PIVOT[PARENT[key]]));
    nodes.set(key, node);
    if (key !== 'body') nodeOf(PARENT[key]).add(node);
    else root.add(node);
    const g = partGeo(key);
    if (g) node.add(mesh(key === 'body' ? 'body' : key, g, '#ffffff'));
    return node;
  };
  // Rider hips sit sunk into the dome of the back (measured seat, see glbStatic history).
  nodeOf('body').add(socket('saddle', sub([0, H - 0.6, -0.8], PIVOT.body)));
  for (const key of buckets.keys()) nodeOf(key);
  return root;
}
