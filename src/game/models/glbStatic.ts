// Admin-uploaded .glb/.gltf overrides: static-rig assets (structures, trees, rocks, bushes)
// are baked once to the same flat-shaded, vertex-coloured geometry the procedural pipeline expects
// (see bake.ts), and RIGID_GLB_KINDS mounts (elephant) bake the same way but keep a quadruped
// `body` pivot + `saddle` socket (see getCustomGlbGroup). Solid-colour packs bake material.color; diffuse textures (pbr baseColor map)
// are sampled per vertex through the mesh UVs, so textured packs keep their look too.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SKINNED_GLB_KINDS, RIGID_GLB_KINDS, type AssetDef } from '@/shared/schema';
import { modelRoot, mesh } from './common';
import { buildVoiRig } from './voiRig';

interface Baked {
  geometry: THREE.BufferGeometry;
  length: number;
  height: number;
}

const cache = new Map<string, Baked>();
const pending = new Map<string, Promise<void>>();

interface SampledMap {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  wrapS: boolean;
  wrapT: boolean;
}

const sampledMaps = new WeakMap<THREE.Texture, SampledMap | null>();

/** Diffuse pixels of a material map (sRGB bytes), or null when unreadable — then the base colour applies. */
function sampleMap(tex: THREE.Texture | null): SampledMap | null {
  if (!tex) return null;
  const hit = sampledMaps.get(tex);
  if (hit !== undefined) return hit;
  let out: SampledMap | null = null;
  try {
    const img = tex.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement | undefined;
    const w = img?.width ?? 0;
    const h = img?.height ?? 0;
    if (img && w > 0 && h > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, w, h);
        out = { data: px.data, w, h, wrapS: tex.wrapS === THREE.RepeatWrapping, wrapT: tex.wrapT === THREE.RepeatWrapping };
      }
    }
  } catch (err) {
    console.warn('glb texture unreadable, using base colour', err);
  }
  sampledMaps.set(tex, out);
  return out;
}

/** Bakes every mesh under `root` (world space) into one flat-shaded, vertex-coloured geometry. */
function bakeStatic(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const pieces: { pos: Float32Array; col: Float32Array; nor: Float32Array }[] = [];
  const color = new THREE.Color();
  const texel = new THREE.Color();
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
    const base = material.color ?? color.set('#ffffff');
    // A glTF diffuse map has flipY=false: v = 0 is the image top row, matching canvas pixels.
    const sampled = sampleMap(material.map ?? null);
    const uv = (sampled ? g.getAttribute('uv') : undefined) as THREE.BufferAttribute | undefined;
    const count = position.count;
    const keep = (i: number): boolean => {
      if (!sampled || !uv) return true;
      const a = sampleAlpha(sampled, uv.getX(i), uv.getY(i));
      return a >= 0.5;
    };
    // Pre-pass: drop whole triangles whose corners are all transparent (alpha-tested foliage).
    const drop = new Uint8Array(count);
    for (let t = 0; t < count; t += 3) {
      if (count - t >= 3 && !keep(t) && !keep(t + 1) && !keep(t + 2)) {
        drop[t] = drop[t + 1] = drop[t + 2] = 1;
      }
    }
    let kept = 0;
    for (let i = 0; i < count; i++) if (!drop[i]) kept++;
    const col = new Float32Array(kept * 3);
    const posArr = new Float32Array(kept * 3);
    const norArr = new Float32Array(kept * 3);
    const srcPos = position.array as Float32Array;
    let o = 0;
    for (let i = 0; i < count; i++) {
      if (drop[i]) continue;
      if (sampled && uv) {
        sampleColor(sampled, uv.getX(i), uv.getY(i), texel);
        color.copy(base).multiply(texel);
      } else {
        color.copy(base);
      }
      col.set([color.r, color.g, color.b], o);
      posArr.set(srcPos.subarray(i * 3, i * 3 + 3), o);
      norArr.set((normal as Float32Array).subarray(i * 3, i * 3 + 3), o);
      o += 3;
    }
    pieces.push({ pos: posArr, col, nor: norArr });
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

function samplePixel(map: SampledMap, u: number, v: number): number {
  const wrap = (t: number, repeat: boolean) => (repeat ? ((t % 1) + 1) % 1 : Math.min(1, Math.max(0, t)));
  const x = Math.min(map.w - 1, Math.floor(wrap(u, map.wrapS) * map.w));
  const y = Math.min(map.h - 1, Math.floor(wrap(v, map.wrapT) * map.h));
  return (y * map.w + x) * 4;
}

function sampleAlpha(map: SampledMap, u: number, v: number): number {
  return map.data[samplePixel(map, u, v) + 3] / 255;
}

/** sRGB texel (× base colour already applied by the caller) in working colour space. */
function sampleColor(map: SampledMap, u: number, v: number, out: THREE.Color): THREE.Color {
  const o = samplePixel(map, u, v);
  return out.setRGB(map.data[o] / 255, map.data[o + 1] / 255, map.data[o + 2] / 255, THREE.SRGBColorSpace);
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
export function preloadCustomGlbs(assets: ReadonlyArray<Pick<AssetDef, 'glb' | 'kind'>>): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  // Skinned kinds keep their skeletal animation via glbSkinned.ts — never bake them here.
  const urls = new Set(assets.filter((a) => !(SKINNED_GLB_KINDS as readonly string[]).includes(a.kind)).map((a) => a.glb?.url).filter((u): u is string => !!u));
  return Promise.all([...urls].map(ensureLoading)).then(() => undefined);
}

/** A fresh Group wrapping the baked override geometry, or undefined before it has loaded. */
export function getCustomGlbGroup(url: string, kind?: string): THREE.Group | undefined {
  const baked = cache.get(url);
  if (!baked) return undefined;
  // Rigid-baked mounts (e.g. elephant/voi.glb: one mesh, no skeleton). The file is cut
  // into the quadruped part names (legs, trunk, ears…) so walk/attack articulation applies;
  // see voiRig.ts. A `saddle` socket on the back keeps riders seating.
  if ((RIGID_GLB_KINDS as readonly string[]).includes(kind ?? '')) {
    return buildVoiRig(baked.geometry, baked.height);
  }
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
