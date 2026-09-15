// Admin-uploaded .glb/.gltf overrides for static-rig assets (structures, trees, rocks, bushes),
// baked once to the same flat-shaded, vertex-coloured geometry the procedural pipeline expects
// (see bake.ts). These packs carry no textures — every material is a solid pbrMetallicRoughness
// colour — so baking material.color into vertex colours loses nothing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AssetDef } from '@/shared/schema';
import { modelRoot, mesh } from './common';

interface Baked {
  geometry: THREE.BufferGeometry;
  length: number;
  height: number;
}

const cache = new Map<string, Baked>();
const pending = new Map<string, Promise<void>>();

/** Bakes every mesh under `root` (world space) into one flat-shaded, vertex-coloured geometry. */
function bakeStatic(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const pieces: { pos: Float32Array; col: Float32Array; nor: Float32Array }[] = [];
  const color = new THREE.Color();
  root.traverse((node) => {
    const m = node as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(m.matrixWorld);
    const position = g.getAttribute('position') as THREE.BufferAttribute;
    const flat = new THREE.BufferGeometry().setAttribute('position', position);
    flat.computeVertexNormals();
    const normal = flat.getAttribute('normal').array as Float32Array;
    const material = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    color.copy(material.color ?? color.set('#ffffff'));
    const count = position.count;
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) col.set([color.r, color.g, color.b], i * 3);
    pieces.push({ pos: position.array as Float32Array, col, nor: normal });
  });
  let n = 0;
  for (const p of pieces) n += p.pos.length;
  const pos = new Float32Array(n);
  const col = new Float32Array(n);
  const nor = new Float32Array(n);
  let o = 0;
  for (const p of pieces) {
    pos.set(p.pos, o);
    col.set(p.col, o);
    nor.set(p.nor, o);
    o += p.pos.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/** Recentres on X/Z and drops the model so its lowest point sits on y = 0. */
function ground(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  geo.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  return geo;
}

async function loadOne(loader: GLTFLoader, url: string): Promise<void> {
  const gltf = await loader.loadAsync(url);
  const geometry = ground(bakeStatic(gltf.scene));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  cache.set(url, { geometry, length: box.max.x - box.min.x, height: box.max.y - box.min.y });
}

function ensureLoading(url: string): Promise<void> {
  let p = pending.get(url);
  if (!p) {
    p = loadOne(new GLTFLoader(), url).catch((err) => {
      console.error(`glb load failed: ${url}`, err);
    });
    pending.set(url, p);
  }
  return p;
}

/** Loads (and caches) every asset's uploaded glb override; call before rendering so lookups below are synchronous. */
export function preloadCustomGlbs(assets: ReadonlyArray<Pick<AssetDef, 'glb'>>): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const urls = new Set(assets.map((a) => a.glb?.url).filter((u): u is string => !!u));
  return Promise.all([...urls].map(ensureLoading)).then(() => undefined);
}

/** A fresh Group wrapping the baked override geometry, or undefined before it has loaded. */
export function getCustomGlbGroup(url: string): THREE.Group | undefined {
  const baked = cache.get(url);
  if (!baked) return undefined;
  const root = modelRoot('glb', 'static');
  root.add(mesh('body', baked.geometry.clone(), '#ffffff'));
  return root;
}

/** One wall-tier geometry sized to `height` and stretched to span a `cellSize`-wide run, or undefined before load. */
export function getWallSegmentGeometry(url: string, cellSize: number, height: number, seed: number): THREE.BufferGeometry | undefined {
  const baked = cache.get(url);
  if (!baked) return undefined;
  const g = baked.geometry.clone();
  const sx = cellSize / baked.length;
  const sy = height / baked.height;
  g.scale(sx, sy, sx);
  // Tiny seeded offset so stacked/adjacent tiers don't read as an obviously repeated tile.
  g.rotateY(((seed % 4) - 1.5) * 0.02);
  return g;
}
