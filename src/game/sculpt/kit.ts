// img2threejs sculpt kit: geometry, material and mirror helpers shared by the in-game spec
// builder and every exported TypeScript factory. The export copies this file verbatim, so a
// downloaded factory rebuilds exactly the model the CMS previewed. Keep it dependent on
// three.js only.
//
// Frame: forward +Z, up +Y, the model's own left = +X, metres, feet on y = 0.
// Left/right pairs are reflections (x → -x), never rotations.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export type SculptKitShape =
  | { type: 'box'; size: number[] }
  | { type: 'sphere'; radius: number; detail: number }
  | { type: 'ellipsoid'; radii: number[]; detail: number }
  | { type: 'dome'; radius: number; widthSegments: number; heightSegments: number }
  | { type: 'capsule'; from: number[]; to: number[]; radius: number; radialSegments: number }
  | { type: 'cylinder'; radiusTop: number; radiusBottom: number; height: number; radialSegments: number; openEnded: boolean }
  | { type: 'cone'; radius: number; height: number; radialSegments: number }
  | { type: 'beam'; from: number[]; to: number[]; radiusFrom: number; radiusTo: number; radialSegments: number }
  | { type: 'torus'; radius: number; tube: number; radialSegments: number; tubularSegments: number; arc: number }
  | { type: 'lathe'; profile: number[][]; segments: number }
  | { type: 'extrude'; outline: number[][]; depth: number; bevel: number }
  | { type: 'sweep'; points: number[][]; radii: number[]; radialSegments: number }
  | { type: 'triangles'; vertices: number[][] };

export interface SculptKitMaterial {
  id: string;
  color: string;
  roughness: number;
  metalness: number;
  emissive: number;
  doubleSide: boolean;
  color2: string | null;
  variation: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Deterministic 32-bit seed from a node name (FNV-1a). */
export function seedOf(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small seeded PRNG in [0, 1). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeMaterial(def: SculptKitMaterial): THREE.MeshStandardMaterial {
  const varied = def.color2 !== null && def.variation > 0;
  const m = new THREE.MeshStandardMaterial({
    name: def.id,
    // Varied materials carry their colour in baked vertex colours.
    color: varied ? '#ffffff' : def.color,
    vertexColors: varied,
    roughness: def.roughness,
    metalness: def.metalness,
    flatShading: true,
    side: def.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (def.emissive > 0) {
    m.emissive.set(def.color);
    m.emissiveIntensity = def.emissive;
  }
  return m;
}

/** Geometry centred on its node; oriented shapes (capsule, beam) run between local points. */
export function shapeGeometry(s: SculptKitShape): THREE.BufferGeometry {
  switch (s.type) {
    case 'box':
      return new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]);
    case 'sphere':
      return new THREE.IcosahedronGeometry(s.radius, s.detail);
    case 'ellipsoid':
      return new THREE.IcosahedronGeometry(1, s.detail).scale(s.radii[0], s.radii[1], s.radii[2]);
    case 'dome':
      return new THREE.SphereGeometry(s.radius, s.widthSegments, s.heightSegments, 0, Math.PI * 2, 0, Math.PI / 2);
    case 'capsule': {
      const a = new THREE.Vector3().fromArray(s.from);
      const b = new THREE.Vector3().fromArray(s.to);
      const g = new THREE.CapsuleGeometry(s.radius, a.distanceTo(b), 2, s.radialSegments);
      return orient(g, a, b, a.clone().lerp(b, 0.5));
    }
    case 'cylinder':
      return new THREE.CylinderGeometry(s.radiusTop, s.radiusBottom, s.height, s.radialSegments, 1, s.openEnded);
    case 'cone':
      return new THREE.ConeGeometry(s.radius, s.height, s.radialSegments);
    case 'beam': {
      const a = new THREE.Vector3().fromArray(s.from);
      const b = new THREE.Vector3().fromArray(s.to);
      const len = a.distanceTo(b);
      const g = new THREE.CylinderGeometry(s.radiusTo, s.radiusFrom, len, s.radialSegments).translate(0, len / 2, 0);
      return orient(g, a, b, a);
    }
    case 'torus':
      return new THREE.TorusGeometry(s.radius, s.tube, s.radialSegments, s.tubularSegments, s.arc);
    case 'lathe': {
      // Bottom-to-top profiles face outwards; normalise so a reversed profile is not inside out.
      const profile = s.profile[0][1] > s.profile[s.profile.length - 1][1] ? [...s.profile].reverse() : s.profile;
      return new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(p[0], p[1])), s.segments);
    }
    case 'extrude': {
      const shape = new THREE.Shape(s.outline.map((p) => new THREE.Vector2(p[0], p[1])));
      const g = new THREE.ExtrudeGeometry(shape, { depth: s.depth, bevelEnabled: s.bevel > 0, bevelThickness: s.bevel, bevelSize: s.bevel, bevelSegments: 1, steps: 1 });
      return g.translate(0, 0, -s.depth / 2);
    }
    case 'sweep':
      return sweep(s.points, s.radii, s.radialSegments);
    case 'triangles': {
      const n = s.vertices.length - (s.vertices.length % 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(s.vertices.slice(0, n).flat(), 3));
      g.computeVertexNormals();
      return g;
    }
  }
}

/** Rotates a +Y-aligned geometry onto a→b and moves its origin to `at`. */
function orient(g: THREE.BufferGeometry, a: THREE.Vector3, b: THREE.Vector3, at: THREE.Vector3): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  if (dir.lengthSq() > 1e-12) g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  return g.translate(at.x, at.y, at.z);
}

/**
 * Tapered sweep along a polyline with parallel-transport frames (no Frenet flips): horns,
 * tails, tusks, hair locks. `radii` holds one radius, start/end radii, or one per point.
 */
function sweep(points: number[][], radii: number[], radial: number): THREE.BufferGeometry {
  const pts = points.map((p) => new THREE.Vector3().fromArray(p));
  const n = pts.length;
  const radiusAt = (i: number) => (radii.length === n ? radii[i] : radii[0] + ((radii[radii.length - 1] ?? radii[0]) - radii[0]) * (i / (n - 1)));
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
    const bi = new THREE.Vector3().crossVectors(tangents[i], normals[i]);
    const r = radiusAt(i);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const v = pts[i].clone().addScaledVector(normals[i], Math.cos(a) * r).addScaledVector(bi, Math.sin(a) * r);
      pos.push(v.x, v.y, v.z);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      idx.push(a, a + radial, b, b, a + radial, b + radial);
    }
  }
  const capStart = pos.length / 3;
  pos.push(pts[0].x, pts[0].y, pts[0].z);
  const capEnd = capStart + 1;
  pos.push(pts[n - 1].x, pts[n - 1].y, pts[n - 1].z);
  const last = (n - 1) * radial;
  for (let k = 0; k < radial; k++) {
    idx.push(capStart, k, (k + 1) % radial);
    idx.push(capEnd, last + ((k + 1) % radial), last + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Seeded vertex displacement; welds first so the surface does not crack. */
export function jitterGeometry(geometry: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('normal');
  const welded = mergeVertices(geometry, 1e-4);
  const rnd = random(seed);
  const p = welded.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + (rnd() - 0.5) * amount, p.getY(i) + (rnd() - 0.5) * amount, p.getZ(i) + (rnd() - 0.5) * amount);
  }
  welded.computeVertexNormals();
  return welded;
}

/** Per-face colour variation baked into vertex colours. */
export function faceColors(geometry: THREE.BufferGeometry, def: SculptKitMaterial, seed: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const rnd = random(seed);
  const a = new THREE.Color(def.color);
  const b = new THREE.Color(def.color2 ?? def.color);
  const c = new THREE.Color();
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 3) {
    c.copy(a).lerp(b, rnd() * def.variation);
    for (let k = 0; k < 3 && i + k < count; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function place<T extends THREE.Object3D>(o: T, name: string, position: number[], rotation: number[]): T {
  o.name = name;
  o.position.fromArray(position);
  o.rotation.set(rotation[0], rotation[1], rotation[2]);
  return o;
}

/** Animated pivot: `userData.part` names the rig joint the game animates. */
export function sculptPart(name: string, position: number[], rotation: number[]): THREE.Group {
  const g = place(new THREE.Group(), name, position, rotation);
  g.userData.part = name;
  return g;
}

export function sculptGroup(name: string, position: number[], rotation: number[]): THREE.Group {
  return place(new THREE.Group(), name, position, rotation);
}

/** Attachment point (rider saddle, breath origin). */
export function sculptSocket(name: string, position: number[], rotation: number[]): THREE.Object3D {
  const o = place(new THREE.Object3D(), name, position, rotation);
  o.userData.socket = name;
  return o;
}

export function sculptMesh(
  name: string,
  shape: SculptKitShape,
  def: SculptKitMaterial,
  material: THREE.Material,
  jitter: number,
  position: number[],
  rotation: number[],
  scale: number[],
): THREE.Mesh {
  const seed = seedOf(name);
  let geometry = shapeGeometry(shape);
  if (jitter > 0) geometry = jitterGeometry(geometry, jitter, seed);
  if (def.color2 !== null && def.variation > 0) geometry = faceColors(geometry, def, seed ^ 0x9e3779b9);
  const m = place(new THREE.Mesh(geometry, material), name, position, rotation);
  m.scale.fromArray(scale);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Surface detail: explodes and picks together with its parent part. */
export function detail<T extends THREE.Object3D>(o: T): T {
  o.userData.explodeWithParent = true;
  return o;
}

/** Keeps a branch out of the reflected copy of its ancestor. */
export function oneSided<T extends THREE.Object3D>(o: T): T {
  o.userData.oneSided = true;
  return o;
}

/** Node inside a reflected copy, looked up by its mirrored name. */
export function findNode(subtree: THREE.Object3D, name: string): THREE.Object3D {
  const found = subtree.getObjectByName(name);
  if (!found) throw new Error(`sculpt node "${name}" not found`);
  return found;
}

/** Name of the reflected counterpart: a trailing "L" becomes "R". */
export function mirrorName(name: string): string {
  return name.endsWith('L') ? `${name.slice(0, -1)}R` : name;
}

/** Copy of a geometry reflected across the YZ plane, with triangle winding restored. */
export function reflectGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = source.clone();
  for (const key of ['position', 'normal']) {
    const attr = g.getAttribute(key) as THREE.BufferAttribute | undefined;
    if (!attr) continue;
    for (let i = 0; i < attr.count; i++) attr.setX(i, -attr.getX(i));
  }
  // A reflection turns every triangle inside out: swap two corners of each one.
  if (g.index) {
    const idx = g.index;
    for (let i = 0; i + 2 < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
  } else {
    for (const attr of Object.values(g.attributes) as THREE.BufferAttribute[]) {
      const size = attr.itemSize;
      const arr = attr.array;
      for (let t = 0; t + 2 < attr.count; t += 3) {
        for (let c = 0; c < size; c++) {
          const i1 = (t + 1) * size + c;
          const i2 = (t + 2) * size + c;
          const tmp = arr[i1];
          arr[i1] = arr[i2];
          arr[i2] = tmp;
        }
      }
    }
  }
  return g;
}

/**
 * Reflected deep copy (x → -x) of an authored left-side subtree. Positions mirror, Euler
 * rotations conjugate (rx, -ry, -rz), geometry reflects; names ending in L become R.
 * Branches flagged one-sided (a bow held in the left hand) stay on their side.
 */
export function mirrorObject(source: THREE.Object3D): THREE.Object3D {
  const mesh = source as THREE.Mesh;
  const out: THREE.Object3D = mesh.isMesh ? new THREE.Mesh(reflectGeometry(mesh.geometry), mesh.material) : (source as THREE.Group).isGroup ? new THREE.Group() : new THREE.Object3D();
  out.name = mirrorName(source.name);
  out.userData = { ...source.userData };
  if (typeof out.userData.part === 'string') out.userData.part = mirrorName(out.userData.part);
  if (typeof out.userData.socket === 'string') out.userData.socket = mirrorName(out.userData.socket);
  out.position.set(-source.position.x, source.position.y, source.position.z);
  out.rotation.set(source.rotation.x, -source.rotation.y, -source.rotation.z, source.rotation.order);
  out.scale.copy(source.scale);
  out.castShadow = source.castShadow;
  out.receiveShadow = source.receiveShadow;
  for (const child of source.children) {
    if (!child.userData.oneSided) out.add(mirrorObject(child));
  }
  return out;
}

export function sculptRoot(name: string, rig: string, weaponStyle: string): THREE.Group {
  const root = new THREE.Group();
  root.name = name;
  root.userData.rig = rig;
  if (rig === 'humanoid') {
    // The game's humanoid animation reads these (see render/animate.ts).
    root.userData.weapon = { none: 'none', swing: 'sword', thrust: 'spear', bow: 'bow', staff: 'staff' }[weaponStyle] ?? 'none';
    root.userData.weaponHand = weaponStyle === 'bow' ? 'L' : 'R';
  }
  return root;
}
