'use client';

// Downloads a model as TypeScript, glTF/GLB, OBJ, STL, PLY, USDZ or (img2threejs only) the raw
// spec. Sculpted models export a server-generated img2threejs factory; procedural presets export
// a standalone module with the baked part tree. Mesh exports use flat normals (faceted look).
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { buildSculptModel } from '@/game/sculpt/build';
import type { SculptSpec } from '@/shared/sculpt';

export const EXPORT_FORMATS = [
  { id: 'ts', label: 'TypeScript', hint: 'factory three.js dựng lại model (img2threejs: code procedural; preset: cây part đã bake)' },
  { id: 'glb', label: 'GLB', hint: 'glTF nhị phân, giữ cây part/socket trong extras' },
  { id: 'gltf', label: 'glTF', hint: 'glTF JSON' },
  { id: 'obj', label: 'OBJ', hint: 'lưới + màu theo đỉnh' },
  { id: 'stl', label: 'STL', hint: 'in 3D, không màu' },
  { id: 'ply', label: 'PLY', hint: 'lưới + màu theo đỉnh' },
  { id: 'usdz', label: 'USDZ', hint: 'AR Quick Look (iOS)' },
  { id: 'json', label: 'Spec JSON', hint: 'sculpt spec gốc (chỉ model img2threejs)' },
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number]['id'];

/** What to export: an img2threejs spec, or any procedural model built on demand. */
export type ExportSource = { spec: SculptSpec; name: string } | { build: () => THREE.Object3D; name: string };

export function download(data: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'model';
}

/** Model prepared for file export: flat normals, optional material colour baked per vertex. */
function exportRoot(source: ExportSource, bakeColors: 'none' | 'float' | 'uchar'): THREE.Object3D {
  const root = 'spec' in source ? buildSculptModel(source.spec) : source.build();
  const color = new THREE.Color();
  const vertex = new THREE.Color();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    if (bakeColors !== 'none') {
      const base = (mesh.material as THREE.MeshStandardMaterial).color ?? color.set('#ffffff');
      const src = g.getAttribute('color');
      const count = g.getAttribute('position').count;
      const uchar = bakeColors === 'uchar';
      const out = uchar ? new Uint8Array(count * 3) : new Float32Array(count * 3);
      const tint = base.clone();
      for (let i = 0; i < count; i++) {
        color.copy(tint);
        if (src) color.multiply(vertex.setRGB(src.getX(i), src.getY(i), src.getZ(i)));
        out.set(uchar ? [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)] : [color.r, color.g, color.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(out, 3, uchar));
    }
    mesh.geometry = g;
  });
  root.updateMatrixWorld(true);
  return root;
}

function base64(array: Float32Array): string {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** Standalone three.js module rebuilding the node tree (names, part/socket/rig userData) with baked vertex-coloured meshes. */
function bakedTypeScript(root: THREE.Object3D, name: string): string {
  type Node = { name: string; parent: number; p: number[]; q: number[]; s: number[]; userData: Record<string, unknown>; mesh?: [string, string] };
  const nodes: Node[] = [];
  const visit = (o: THREE.Object3D, parent: number) => {
    const node: Node = { name: o.name, parent, p: o.position.toArray().map(round), q: o.quaternion.toArray().map(round), s: o.scale.toArray().map(round), userData: JSON.parse(JSON.stringify(o.userData)) };
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) node.mesh = [base64(mesh.geometry.getAttribute('position').array as Float32Array), base64(mesh.geometry.getAttribute('color').array as Float32Array)];
    const index = nodes.push(node) - 1;
    for (const c of o.children) visit(c, index);
  };
  visit(root, -1);
  const fn = `create${slug(name).split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('').replace(/^[0-9]+/, '') || 'Baked'}Model`;
  return `// ${name} — exported from the model workshop (/models) of Mini Battle Simulator.
// Baked procedural model: node tree with part/socket/rig userData (animation contract) and
// flat-shaded, vertex-coloured meshes. Requires three.js.
import * as THREE from 'three';

type BakedNode = { name: string; parent: number; p: number[]; q: number[]; s: number[]; userData: Record<string, unknown>; mesh?: [position: string, color: string] };

const NODES: BakedNode[] = ${JSON.stringify(nodes)};

function floats(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function ${fn}(material: THREE.Material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 })): THREE.Group {
  const objects: THREE.Object3D[] = [];
  for (const n of NODES) {
    let o: THREE.Object3D;
    if (n.mesh) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(floats(n.mesh[0]), 3));
      g.setAttribute('color', new THREE.BufferAttribute(floats(n.mesh[1]), 3));
      g.computeVertexNormals();
      o = new THREE.Mesh(g, material);
      o.castShadow = true;
    } else o = n.parent < 0 ? new THREE.Group() : new THREE.Object3D();
    o.name = n.name;
    o.position.fromArray(n.p);
    o.quaternion.fromArray(n.q);
    o.scale.fromArray(n.s);
    o.userData = n.userData;
    if (n.parent >= 0) objects[n.parent].add(o);
    objects.push(o);
  }
  return objects[0] as THREE.Group;
}
`;
}

export async function exportModel(format: ExportFormat, source: ExportSource): Promise<void> {
  const name = slug(source.name);
  switch (format) {
    case 'ts': {
      if (!('spec' in source)) return download(bakedTypeScript(exportRoot(source, 'float'), source.name), `${name}.ts`, 'text/plain');
      const res = await fetch('/api/admin/studio/codegen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec: source.spec }), cache: 'no-store' });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
      const file = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${name}.ts`;
      return download(await res.text(), file, 'text/plain');
    }
    case 'json':
      if (!('spec' in source)) throw new Error('Model procedural không có sculpt spec');
      return download(JSON.stringify(source.spec, null, 2), `${name}.sculpt.json`, 'application/json');
    case 'glb': {
      const data = await new GLTFExporter().parseAsync(exportRoot(source, 'none'), { binary: true });
      return download(data as ArrayBuffer, `${name}.glb`, 'model/gltf-binary');
    }
    case 'gltf': {
      const data = await new GLTFExporter().parseAsync(exportRoot(source, 'none'), { binary: false });
      return download(JSON.stringify(data), `${name}.gltf`, 'model/gltf+json');
    }
    case 'obj':
      return download(new OBJExporter().parse(exportRoot(source, 'float')), `${name}.obj`, 'text/plain');
    case 'stl': {
      const data = new STLExporter().parse(exportRoot(source, 'none'), { binary: true });
      return download(data, `${name}.stl`, 'model/stl');
    }
    case 'ply': {
      const data = await new Promise<ArrayBuffer>((resolve) => new PLYExporter().parse(exportRoot(source, 'uchar'), (r) => resolve(r as ArrayBuffer), { binary: true }));
      return download(data, `${name}.ply`, 'application/octet-stream');
    }
    case 'usdz': {
      const data = await new USDZExporter().parseAsync(exportRoot(source, 'none') as THREE.Object3D);
      return download(data as BlobPart, `${name}.usdz`, 'model/vnd.usdz+zip');
    }
  }
}
