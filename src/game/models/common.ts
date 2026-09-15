// Shared low-poly building blocks for the procedural model factories.
//
// img2threejs contract followed by every factory in this folder:
// - code-only procedural geometry (no downloaded meshes), TypeScript + plain Three.js;
// - factory `createXModel(params, options)` returns a THREE.Group; params (reconstruction
//   data) stay separate from renderer objects;
// - frame: forward +Z, up +Y, character's own left = +X, feet at y = 0, metres;
// - every mesh is named; animated sub-assemblies are pivot Groups tagged
//   `userData.part`, attachment points are Object3Ds tagged `userData.socket`,
//   surface details carry `userData.explodeWithParent` (explodable + clickable);
// - left/right pairs are authored by reflecting x (sign), never by rotation;
// - all procedural noise is seeded (deterministic).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../sim/rng';

export type Vec3 = [number, number, number];
export { Rng };

export type RigKind = 'humanoid' | 'quadruped' | 'dragon' | 'bird' | 'catapult' | 'chest' | 'tower' | 'static';

interface MatOptions {
  roughness?: number;
  metalness?: number;
  emissive?: number;
  doubleSide?: boolean;
  /** Smooth shading (keeps vertex normals) for high-poly reference-matched models. */
  smooth?: boolean;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: string, opts: MatOptions = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.roughness ?? 0.85}|${opts.metalness ?? 0}|${opts.emissive ?? 0}|${opts.doubleSide ? 1 : 0}|${opts.smooth ? 1 : 0}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: !opts.smooth,
      roughness: opts.roughness ?? 0.85,
      metalness: opts.metalness ?? 0,
      side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (opts.emissive) {
      m.emissive.set(color);
      m.emissiveIntensity = opts.emissive;
    }
    materials.set(key, m);
  }
  return m;
}

const vertexColorMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
const smoothVertexColorMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: false, roughness: 0.85 });

export function mesh(
  name: string,
  geometry: THREE.BufferGeometry,
  color: string,
  pos: Vec3 = [0, 0, 0],
  rot: Vec3 = [0, 0, 0],
  opts: MatOptions = {},
): THREE.Mesh {
  const material = geometry.getAttribute('color') ? (opts.smooth ? smoothVertexColorMaterial : vertexColorMaterial) : mat(color, opts);
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function metal(name: string, geometry: THREE.BufferGeometry, color: string, pos?: Vec3, rot?: Vec3): THREE.Mesh {
  return mesh(name, geometry, color, pos, rot, { roughness: 0.45, metalness: 0.35 });
}

/** Animated pivot. Bind rotation stays identity; meshes carry their own orientation. */
export function part(name: string, pos: Vec3): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.userData.part = name;
  g.position.set(...pos);
  return g;
}

export function socket(name: string, pos: Vec3, rot: Vec3 = [0, 0, 0]): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = `socket:${name}`;
  o.userData.socket = name;
  o.position.set(...pos);
  o.rotation.set(...rot);
  return o;
}

export function detail<T extends THREE.Object3D>(o: T): T {
  o.userData.explodeWithParent = true;
  return o;
}

export function add(parent: THREE.Object3D, ...children: THREE.Object3D[]): THREE.Object3D {
  for (const c of children) parent.add(c);
  return parent;
}

// ---------------------------------------------------------------- geometry

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

export function cyl(rTop: number, rBottom: number, h: number, seg = 7): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, h, seg);
}

export function cone(r: number, h: number, seg = 7): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, h, seg);
}

export function ball(r: number, detailLevel = 1): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(r, detailLevel);
}

export function ell(rx: number, ry: number, rz: number, detailLevel = 1): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1, detailLevel).scale(rx, ry, rz);
}

export function dome(r: number, wSeg = 8, hSeg = 3): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, wSeg, hSeg, 0, Math.PI * 2, 0, Math.PI / 2);
}

/** Capsule hanging from the origin down to -len (rounded ends overlap the joints). */
export function limb(r: number, len: number, radial = 7): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, len, 2, radial).translate(0, -len / 2, 0);
}

/** Tapered cylinder from point a to point b. */
export function beam(a: Vec3, b: Vec3, rA: number, rB: number, radial = 6): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const dir = new THREE.Vector3(...b).sub(va);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(rB, rA, len, radial).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  return g.translate(va.x, va.y, va.z);
}

/**
 * Tapered sweep along a polyline with parallel-transport frames (no Frenet flips).
 * Use for horns, tusks, tails, necks — anything whose cross-section narrows.
 */
export function sweep(points: Vec3[], radii: number[], radial = 6): THREE.BufferGeometry {
  const pts = points.map((p) => new THREE.Vector3(...p));
  const n = pts.length;
  const radiusAt = (i: number) => (radii.length === n ? radii[i] : radii[0] + (radii[radii.length - 1] - radii[0]) * (i / (n - 1)));
  const tangents = pts.map((_, i) => new THREE.Vector3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize());
  const normals: THREE.Vector3[] = [];
  const ref = Math.abs(tangents[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  normals[0] = new THREE.Vector3().crossVectors(tangents[0], ref).normalize();
  for (let i = 1; i < n; i++) {
    const prev = normals[i - 1];
    normals[i] = prev.clone().sub(tangents[i].clone().multiplyScalar(prev.dot(tangents[i]))).normalize();
  }
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const b = new THREE.Vector3().crossVectors(tangents[i], normals[i]);
    const r = radiusAt(i);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const v = pts[i].clone().addScaledVector(normals[i], Math.cos(a) * r).addScaledVector(b, Math.sin(a) * r);
      pos.push(v.x, v.y, v.z);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  }
  const capStart = pos.length / 3;
  pos.push(pts[0].x, pts[0].y, pts[0].z);
  const capEnd = capStart + 1;
  pos.push(pts[n - 1].x, pts[n - 1].y, pts[n - 1].z);
  for (let k = 0; k < radial; k++) {
    idx.push(capStart, k, (k + 1) % radial);
    const base = (n - 1) * radial;
    idx.push(capEnd, base + ((k + 1) % radial), base + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat triangle list (for wing membranes, leaves, cloth). Pair with a double-sided material. */
export function triangles(...tris: [Vec3, Vec3, Vec3][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3));
  g.computeVertexNormals();
  return g;
}

/** Seeded vertex displacement; welds vertices first so the surface does not crack. */
export function jitter(geometry: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('normal');
  const welded = mergeVertices(geometry, 1e-4);
  const rng = new Rng(seed);
  const p = welded.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + (rng.next() - 0.5) * amount, p.getY(i) + (rng.next() - 0.5) * amount, p.getZ(i) + (rng.next() - 0.5) * amount);
  }
  welded.computeVertexNormals();
  return welded;
}

/** Per-face colour variation between two colours (baked vertex colours). */
export function faceColors(geometry: THREE.BufferGeometry, a: string, b: string, seed: number, mix = 1): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const rng = new Rng(seed);
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  const tmp = new THREE.Color();
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 3) {
    tmp.copy(ca).lerp(cb, rng.next() * mix);
    for (let k = 0; k < 3; k++) colors.set([tmp.r, tmp.g, tmp.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export function shade(hex: string, factor: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  return `#${c.getHexString()}`;
}

export function modelRoot(name: string, rig: RigKind, smooth = false): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.userData.rig = rig;
  if (smooth) g.userData.smooth = true;
  return g;
}

// ---------------------------------------------------------------- implicit surfaces

/** Signed distance: negative inside. */
export type Sdf = (x: number, y: number, z: number) => number;

export function sdEllipsoid(c: Vec3, r: Vec3): Sdf {
  const m = Math.min(r[0], r[1], r[2]);
  return (x, y, z) => (Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]) - 1) * m;
}

/** Round cone between a (radius ra) and b (radius rb). */
export function sdCapsule(a: Vec3, b: Vec3, ra: number, rb = ra): Sdf {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const len2 = bx * bx + by * by + bz * bz;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / len2));
    return Math.hypot(px - bx * t, py - by * t, pz - bz * t) - (ra + (rb - ra) * t);
  };
}

/** Polynomial smooth union of several fields (blend radius k, metres). */
export function smoothUnion(k: number, ...fields: Sdf[]): Sdf {
  return (x, y, z) => {
    let d = fields[0](x, y, z);
    for (let i = 1; i < fields.length; i++) {
      const e = fields[i](x, y, z);
      const h = Math.max(k - Math.abs(d - e), 0) / k;
      d = Math.min(d, e) - h * h * k * 0.25;
    }
    return d;
  };
}

export function subtract(a: Sdf, b: Sdf): Sdf {
  return (x, y, z) => Math.max(a(x, y, z), -b(x, y, z));
}

/**
 * Meshes an implicit surface with naive surface nets (one vertex per sign-changing cell,
 * quads across crossing edges) and gradient normals, so blended organic forms read as one
 * continuous smooth skin. `paint` colours each vertex; pair with `mesh(..., { smooth: true })`.
 */
export function implicit(field: Sdf, min: Vec3, max: Vec3, cell: number, paint: (x: number, y: number, z: number) => THREE.ColorRepresentation): THREE.BufferGeometry {
  const nx = Math.ceil((max[0] - min[0]) / cell), ny = Math.ceil((max[1] - min[1]) / cell), nz = Math.ceil((max[2] - min[2]) / cell);
  const sx = nx + 1, sy = ny + 1;
  const values = new Float32Array(sx * sy * (nz + 1));
  const at = (i: number, j: number, k: number) => (k * sy + j) * sx + i;
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) values[at(i, j, k)] = field(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
  const edges = [[0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 1, 0], [0, 1, 0, 1, 1, 0], [0, 0, 0, 0, 1, 0], [0, 0, 1, 1, 0, 1], [1, 0, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [1, 1, 0, 1, 1, 1], [0, 1, 0, 0, 1, 1]];
  const cellIndex = new Int32Array(nx * ny * nz).fill(-1);
  const cid = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const eps = cell * 0.25;
  const color = new THREE.Color();
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let n = 0, ax = 0, ay = 0, az = 0;
    for (const e of edges) {
      const a = values[at(i + e[0], j + e[1], k + e[2])], b = values[at(i + e[3], j + e[4], k + e[5])];
      if ((a <= 0) === (b <= 0)) continue;
      const t = a / (a - b);
      ax += e[0] + (e[3] - e[0]) * t; ay += e[1] + (e[4] - e[1]) * t; az += e[2] + (e[5] - e[2]) * t;
      n++;
    }
    if (!n) continue;
    const x = min[0] + (i + ax / n) * cell, y = min[1] + (j + ay / n) * cell, z = min[2] + (k + az / n) * cell;
    cellIndex[cid(i, j, k)] = pos.length / 3;
    pos.push(x, y, z);
    const g = new THREE.Vector3(field(x + eps, y, z) - field(x - eps, y, z), field(x, y + eps, z) - field(x, y - eps, z), field(x, y, z + eps) - field(x, y, z - eps));
    if (g.lengthSq() < 1e-20) g.set(0, 1, 0);
    g.normalize();
    nor.push(g.x, g.y, g.z);
    color.set(paint(x, y, z));
    col.push(color.r, color.g, color.b);
  }
  // one quad per crossing grid edge, joining the four cells around it
  const quad = (a: number, b: number, c: number, d: number, flipped: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flipped) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
    const inside = values[at(i, j, k)] <= 0;
    if (inside === (values[at(i + 1, j, k)] <= 0)) continue;
    quad(cellIndex[cid(i, j - 1, k - 1)], cellIndex[cid(i, j, k - 1)], cellIndex[cid(i, j, k)], cellIndex[cid(i, j - 1, k)], !inside);
  }
  for (let k = 1; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) {
    const inside = values[at(i, j, k)] <= 0;
    if (inside === (values[at(i, j + 1, k)] <= 0)) continue;
    quad(cellIndex[cid(i - 1, j, k - 1)], cellIndex[cid(i - 1, j, k)], cellIndex[cid(i, j, k)], cellIndex[cid(i, j, k - 1)], !inside);
  }
  for (let k = 0; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
    const inside = values[at(i, j, k)] <= 0;
    if (inside === (values[at(i, j, k + 1)] <= 0)) continue;
    quad(cellIndex[cid(i - 1, j - 1, k)], cellIndex[cid(i, j - 1, k)], cellIndex[cid(i, j, k)], cellIndex[cid(i - 1, j, k)], !inside);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}
