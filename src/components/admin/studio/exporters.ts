'use client';

// Downloads a sculpt version as TypeScript (server-generated factory), glTF/GLB, OBJ, STL,
// PLY, USDZ or the raw spec. Mesh exports use flat normals so they keep the faceted look.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { buildSculptModel } from '@/game/sculpt/build';
import type { SculptSpec } from '@/shared/sculpt';

export const EXPORT_FORMATS = [
  { id: 'ts', label: 'TypeScript', hint: 'factory procedural chuẩn img2threejs (three.js)' },
  { id: 'glb', label: 'GLB', hint: 'glTF nhị phân, giữ cây part/socket trong extras' },
  { id: 'gltf', label: 'glTF', hint: 'glTF JSON' },
  { id: 'obj', label: 'OBJ', hint: 'lưới + màu theo đỉnh' },
  { id: 'stl', label: 'STL', hint: 'in 3D, không màu' },
  { id: 'ply', label: 'PLY', hint: 'lưới + màu theo đỉnh' },
  { id: 'usdz', label: 'USDZ', hint: 'AR Quick Look (iOS)' },
  { id: 'json', label: 'Spec JSON', hint: 'sculpt spec gốc' },
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number]['id'];

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

function slug(spec: SculptSpec, n: number): string {
  const base = spec.name
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'model'}-v${n}`;
}

/** Model prepared for file export: flat normals, optional material colour baked per vertex. */
function exportRoot(spec: SculptSpec, bakeColors: 'none' | 'float' | 'uchar'): THREE.Group {
  const root = buildSculptModel(spec);
  const color = new THREE.Color();
  const vertex = new THREE.Color();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    if (bakeColors !== 'none') {
      const base = (mesh.material as THREE.MeshStandardMaterial).color;
      const src = g.getAttribute('color');
      const count = g.getAttribute('position').count;
      const uchar = bakeColors === 'uchar';
      const out = uchar ? new Uint8Array(count * 3) : new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        color.copy(base);
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

export async function exportVersion(format: ExportFormat, spec: SculptSpec, jobId: string, n: number): Promise<void> {
  const name = slug(spec, n);
  switch (format) {
    case 'ts': {
      const a = document.createElement('a');
      a.href = `/api/admin/studio/${jobId}/export?v=${n}`;
      a.click();
      return;
    }
    case 'json':
      return download(JSON.stringify(spec, null, 2), `${name}.sculpt.json`, 'application/json');
    case 'glb': {
      const data = await new GLTFExporter().parseAsync(exportRoot(spec, 'none'), { binary: true });
      return download(data as ArrayBuffer, `${name}.glb`, 'model/gltf-binary');
    }
    case 'gltf': {
      const data = await new GLTFExporter().parseAsync(exportRoot(spec, 'none'), { binary: false });
      return download(JSON.stringify(data), `${name}.gltf`, 'model/gltf+json');
    }
    case 'obj':
      return download(new OBJExporter().parse(exportRoot(spec, 'float')), `${name}.obj`, 'text/plain');
    case 'stl': {
      const data = new STLExporter().parse(exportRoot(spec, 'none'), { binary: true });
      return download(data, `${name}.stl`, 'model/stl');
    }
    case 'ply': {
      const data = await new Promise<ArrayBuffer>((resolve) => new PLYExporter().parse(exportRoot(spec, 'uchar'), (r) => resolve(r as ArrayBuffer), { binary: true }));
      return download(data, `${name}.ply`, 'application/octet-stream');
    }
    case 'usdz': {
      const data = await new USDZExporter().parseAsync(exportRoot(spec, 'none'));
      return download(data as BlobPart, `${name}.usdz`, 'model/vnd.usdz+zip');
    }
  }
}
