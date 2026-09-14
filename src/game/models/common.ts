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
}

const materials = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: string, opts: MatOptions = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.roughness ?? 0.85}|${opts.metalness ?? 0}|${opts.emissive ?? 0}|${opts.doubleSide ? 1 : 0}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
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

export function mesh(
  name: string,
  geometry: THREE.BufferGeometry,
  color: string,
  pos: Vec3 = [0, 0, 0],
  rot: Vec3 = [0, 0, 0],
  opts: MatOptions = {},
): THREE.Mesh {
  const material = geometry.getAttribute('color') ? vertexColorMaterial : mat(color, opts);
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

export function modelRoot(name: string, rig: RigKind): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.userData.rig = rig;
  return g;
}
