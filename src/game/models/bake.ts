// Bakes an authored model hierarchy into rigid parts for instanced rendering and ragdolls.
//
// Each `userData.part` pivot becomes one part: all meshes beneath it (down to the next
// pivot) are merged into a single vertex-coloured geometry expressed in the part's rigid
// frame. The renderer then draws one InstancedMesh per part per unit type, so draw calls
// do not grow with army size. A nested model root (a rider on a mount) starts a new
// animation segment with its own rig kind.
import * as THREE from 'three';
import type { RigKind } from './common';

export interface PartTemplate {
  /** Segment-prefixed name, e.g. "rider.armL". */
  name: string;
  local: string;
  parent: number;
  segment: number;
  /** Rest transform relative to the parent part frame. */
  bind: THREE.Matrix4;
  /** Rest transform in model space. */
  rest: THREE.Matrix4;
  geometry: THREE.BufferGeometry | null;
  box: THREE.Box3 | null;
  /** Falls away on death (held weapons, shields). */
  detachable: boolean;
}

export interface SegmentTemplate {
  rig: RigKind;
  prefix: string;
  mounted: boolean;
  meta: Record<string, unknown>;
  parts: Record<string, number>;
}

export interface ModelTemplate {
  parts: PartTemplate[];
  segments: SegmentTemplate[];
  sockets: Record<string, { part: number; matrix: THREE.Matrix4 }>;
  bounds: THREE.Box3;
}

const DETACHABLE = new Set(['weapon', 'offhand']);

export function bakeModel(root: THREE.Object3D): ModelTemplate {
  root.updateMatrixWorld(true);
  const parts: PartTemplate[] = [];
  const segments: SegmentTemplate[] = [];
  const sockets: ModelTemplate['sockets'] = {};
  const pieces: THREE.BufferGeometry[][] = [];
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  const rigid = (m: THREE.Matrix4) => {
    m.decompose(pos, quat, scl);
    return new THREE.Matrix4().compose(pos, quat, one);
  };

  const addPart = (node: THREE.Object3D, local: string, parent: number, segment: number): number => {
    const rest = rigid(node.matrixWorld);
    const bind = parent >= 0 ? parts[parent].rest.clone().invert().multiply(rest) : rest.clone();
    const seg = segments[segment];
    parts.push({ name: seg.prefix + local, local, parent, segment, bind, rest, geometry: null, box: null, detachable: DETACHABLE.has(local) });
    seg.parts[local] = parts.length - 1;
    pieces.push([]);
    return parts.length - 1;
  };

  const visit = (node: THREE.Object3D, partIdx: number, segIdx: number) => {
    let p = partIdx;
    let s = segIdx;
    if (node.userData.rig) {
      segments.push({ rig: node.userData.rig, prefix: node.userData.prefix ?? 'rider.', mounted: true, meta: { ...node.userData }, parts: {} });
      s = segments.length - 1;
      p = addPart(node, 'root', partIdx, s);
    } else if (node.userData.part) {
      p = addPart(node, node.userData.part, partIdx, s);
    }
    if (node.userData.socket) {
      sockets[segments[s].prefix + node.userData.socket] = { part: p, matrix: parts[p].rest.clone().invert().multiply(node.matrixWorld) };
    }
    const m = node as THREE.Mesh;
    if (m.isMesh) pieces[p].push(bakeMesh(m, parts[p].rest));
    for (const child of node.children) visit(child, p, s);
  };

  segments.push({ rig: (root.userData.rig as RigKind) ?? 'static', prefix: '', mounted: false, meta: { ...root.userData }, parts: {} });
  const rootIdx = addPart(root, 'root', -1, 0);
  // The root itself carries the asset scale; its rest frame is rigid, scale lives in geometry.
  for (const child of root.children) visit(child, rootIdx, 0);

  const bounds = new THREE.Box3();
  parts.forEach((part, i) => {
    if (pieces[i].length === 0) return;
    part.geometry = merge(pieces[i]);
    part.geometry.computeBoundingBox();
    part.box = part.geometry.boundingBox!.clone();
    bounds.union(part.box.clone().applyMatrix4(part.rest));
  });
  return { parts, segments, sockets, bounds };
}

const tmpColor = new THREE.Color();

function bakeMesh(mesh: THREE.Mesh, partRest: THREE.Matrix4): THREE.BufferGeometry {
  const toPart = partRest.clone().invert().multiply(mesh.matrixWorld);
  let g = mesh.geometry.clone();
  if (g.index) g = g.toNonIndexed();
  g.applyMatrix4(toPart);
  const position = g.getAttribute('position') as THREE.BufferAttribute;
  const count = position.count;
  const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
  const base = material.color ?? tmpColor.set('#ffffff');
  const emissive = material.emissive && material.emissiveIntensity > 0 ? 1 + material.emissiveIntensity * 0.6 : 1;
  const src = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = (src ? src.getX(i) : 1) * base.r * emissive;
    const gg = (src ? src.getY(i) : 1) * base.g * emissive;
    const b = (src ? src.getZ(i) : 1) * base.b * emissive;
    colors[i * 3] = r;
    colors[i * 3 + 1] = gg;
    colors[i * 3 + 2] = b;
  }
  let positions: Float32Array = position.array as Float32Array;
  let cols: Float32Array = colors;
  if (toPart.determinant() < 0) {
    positions = flip(positions);
    cols = flip(cols);
  }
  if (material.side === THREE.DoubleSide) {
    positions = concat(positions, flip(positions));
    cols = concat(cols, flip(cols));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
  return out;
}

/** Reverse triangle winding of a non-indexed xyz stream. */
function flip(a: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let t = 0; t < a.length; t += 9) {
    out.set(a.subarray(t, t + 3), t);
    out.set(a.subarray(t + 6, t + 9), t + 3);
    out.set(a.subarray(t + 3, t + 6), t + 6);
  }
  return out;
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of list) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.getAttribute('position').array as Float32Array, o);
    col.set(g.getAttribute('color').array as Float32Array, o);
    o += g.getAttribute('position').count * 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

/** Single merged geometry of a whole template at rest (scenery instancing). */
export function mergeTemplate(t: ModelTemplate): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = [];
  for (const p of t.parts) {
    if (!p.geometry) continue;
    const g = p.geometry.clone();
    g.applyMatrix4(p.rest);
    list.push(g);
  }
  return merge(list);
}
