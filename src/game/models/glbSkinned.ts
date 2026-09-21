// Skeletal (.glb with embedded clips) overrides for animated-rig assets (see
// SKINNED_GLB_KINDS in shared/schema.ts). Unlike glbStatic.ts — which bakes static-rig packs
// into one vertex-coloured mesh — these keep their skin + AnimationClips and play them through
// one AnimationMixer per battle instance (see render/units.ts).
//
// A file is normalised on load: lifted so its lowest point sits on y = 0 (the authored pivot
// stays where the artist put it on X/Z) and uniformly scaled so its rest height is
// NORMALIZED_HEIGHT, meaning asset.scale behaves the same as for procedural models.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

export type SkinState = 'idle' | 'walk' | 'run' | 'attack' | 'death' | 'jump';

/** Rest height (m) every skinned file is normalised to at scale 1. */
export const NORMALIZED_HEIGHT = 2;

interface Baked {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

const cache = new Map<string, Baked>();
const pending = new Map<string, Promise<void>>();

const loader = new GLTFLoader();

/** Clip keywords per battle state; matches Quaternius-style names like "Armature|Velociraptor_Run". */
const KEYWORDS: Record<SkinState, string[]> = {
  idle: ['idle', 'hover', 'fly'],
  walk: ['walk', 'fly'],
  run: ['run', 'fly'],
  attack: ['spell', 'cast', 'staff_attack', 'attack', 'shoot', 'bite', 'strike', 'punch', 'slash', 'kick', 'hit'],
  death: ['death', 'die', 'dead'],
  jump: ['jump', 'leap', 'fly'],
};

/** Best clip name in `names` for `state` (case-insensitive substring), or null. Pure — unit-tested. */
export function pickClipName(names: readonly string[], state: SkinState): string | null {
  const low = names.map((n) => n.toLowerCase());
  for (const k of KEYWORDS[state]) {
    const i = low.findIndex((n) => n.includes(k));
    if (i >= 0) return names[i];
  }
  return null;
}

/** Material-name → hex recolour applied to a skeletal file on load (e.g. red dragon → green). */
export type SkinTint = Record<string, string | { from: string; to: string }>;

function tintKey(tint: SkinTint): string {
  const keys = Object.keys(tint).sort();
  return keys.length ? JSON.stringify(keys.map((k) => [k, tint[k]])) : '';
}

function cacheKey(url: string, tint: SkinTint, hide: readonly string[] = []): string {
  const t = tintKey(tint);
  const h = hide.length ? `|hide:${[...hide].sort().join(',')}` : '';
  return `${url}|${t}${h}`;
}

/** Drops meshes/nodes listed in the asset's `hide` (e.g. a pack's spare weapons). */
function applyHide(scene: THREE.Group, hide: readonly string[]): void {
  if (!hide.length) return;
  const drop = new Set(hide);
  const victims: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (drop.has(o.name)) victims.push(o);
  });
  for (const v of victims) v.parent?.remove(v);
}

/** Recolours the file's own materials in place (each cache entry parses the file fresh). */
function applyTint(scene: THREE.Group, tint: SkinTint): void {
  if (!Object.keys(tint).length) return;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const std = mat as THREE.MeshStandardMaterial;
      const rule = std?.name ? tint[std.name] : undefined;
      if (!rule || !std) continue;
      if (typeof rule === 'string') {
        std.color.set(rule);
      } else if (std.map) {
        std.map = repaintMap(std.map, rule.from, rule.to);
      }
    }
  });
}

const repaintedMaps = new WeakMap<THREE.Texture, Map<string, THREE.Texture>>();

/**
 * Returns a copy of a diffuse texture with pixels near `from` shifted toward `to`.
 * Hue and saturation come from `to`, luminance mostly follows `to` but keeps a share of the
 * original shading, so folds and trim stay readable; everything else is untouched.
 */
function repaintMap(tex: THREE.Texture, from: string, to: string): THREE.Texture {
  let perTex = repaintedMaps.get(tex);
  const key = `${from}>${to}`;
  const hit = perTex?.get(key);
  if (hit) return hit;
  let out = tex;
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
        repaintPixels(px.data, from, to);
        ctx.putImageData(px, 0, 0);
        const next = new THREE.CanvasTexture(canvas);
        next.wrapS = tex.wrapS;
        next.wrapT = tex.wrapT;
        next.colorSpace = tex.colorSpace;
        next.flipY = tex.flipY;
        out = next;
      }
    }
  } catch (err) {
    console.warn('glb texture repaint failed, keeping original', err);
  }
  if (!perTex) {
    perTex = new Map();
    repaintedMaps.set(tex, perTex);
  }
  perTex.set(key, out);
  return out;
}

const tmpToHSL = { h: 0, s: 0, l: 0 };
const tmpPx = new THREE.Color();
const tmpPxHSL = { h: 0, s: 0, l: 0 };

function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Shifts pixels of the `from` hue family toward `to`, leaving skin, trim and hair alone.
 * Match: hue within ±0.09 of `from` (circular) and saturation above 0.2, so dark folds and
 * bright highlights of one cloth all match while white beards, gold trim and brown leather
 * (different hues or near-grey) never do. Hue/saturation come from `to`, luminance mostly
 * follows `to` but keeps a share of the original shading.
 */
export function repaintPixels(data: Uint8ClampedArray, from: string, to: string): void {
  // Everything stays in sRGB numbers (no working-space conversions): hues match the picked hexes.
  const [fr, fg, fb] = hexToRgb01(from);
  tmpPx.setRGB(fr, fg, fb).getHSL(tmpToHSL);
  const fromH = tmpToHSL.h;
  const [tr, tg, tb] = hexToRgb01(to);
  tmpPx.setRGB(tr, tg, tb).getHSL(tmpToHSL);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    tmpPx.setRGB(r, g, b).getHSL(tmpPxHSL);
    if (tmpPxHSL.s <= 0.2) continue;
    const dh = Math.abs(tmpPxHSL.h - fromH);
    if (Math.min(dh, 1 - dh) > 0.09) continue;
    tmpPx.setHSL(tmpToHSL.h, tmpPxHSL.s + (tmpToHSL.s - tmpPxHSL.s) * 0.85, tmpPxHSL.l + (tmpToHSL.l - tmpPxHSL.l) * 0.85);
    data[i] = Math.round(THREE.MathUtils.clamp(tmpPx.r, 0, 1) * 255);
    data[i + 1] = Math.round(THREE.MathUtils.clamp(tmpPx.g, 0, 1) * 255);
    data[i + 2] = Math.round(THREE.MathUtils.clamp(tmpPx.b, 0, 1) * 255);
  }
}

function bake(url: string, tint: SkinTint, hide: readonly string[], gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }): void {
  const scene = gltf.scene;
  applyHide(scene, hide);
  applyTint(scene, tint);
  // Ground and measure from the rendered skinned vertices: Box3.setFromObject reads the
  // pre-skinning bind pose, which some exports leave sprawled far from the posed model.
  const box = skinnedBounds(scene) ?? new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const height = Math.max(0.01, size.y);
  const inner = new THREE.Group();
  inner.add(scene);
  // Lift feet to y = 0 and normalise height; X/Z pivot stays as authored (hips/legs).
  inner.position.y -= box.min.y;
  inner.scale.setScalar(NORMALIZED_HEIGHT / height);
  const root = new THREE.Group();
  root.add(inner);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
  });
  cache.set(cacheKey(url, tint, hide), { scene: root, clips: gltf.animations });
}

/** Rendered bounds of every skinned mesh at bind pose (bindMatrix-aware), or null without skinning. */
export function skinnedBounds(root: THREE.Object3D): THREE.Box3 | null {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let found = false;
  const m4 = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const t = new THREE.Vector3();
  const s = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const idx = m.geometry.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
    const wgt = m.geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
    if (!pos || !idx || !wgt) return;
    found = true;
    m.skeleton.update();
    const bm = m.skeleton.boneMatrices;
    if (!bm) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix);
      s.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = wgt.getComponent(i, k);
        if (w === 0) continue;
        m4.fromArray(bm, idx.getComponent(i, k) * 16);
        t.copy(v).applyMatrix4(m4);
        s.addScaledVector(t, w);
      }
      s.applyMatrix4(m.bindMatrixInverse).applyMatrix4(m.matrixWorld);
      min.min(s);
      max.max(s);
    }
  });
  return found && min.x !== Infinity ? new THREE.Box3(min, max) : null;
}

async function loadOne(url: string, tint: SkinTint, hide: readonly string[]): Promise<void> {
  const gltf = await loader.loadAsync(url);
  bake(url, tint, hide, gltf);
}

function ensureLoading(url: string, tint: SkinTint = {}, hide: readonly string[] = []): Promise<void> {
  const key = cacheKey(url, tint, hide);
  let p = pending.get(key);
  if (!p) {
    p = loadOne(url, tint, hide).catch((err) => {
      console.error(`skinned glb load failed: ${url}`, err);
    });
    pending.set(key, p);
  }
  return p;
}

/** True once the file has loaded (a per-instance clone can be made). */
export function skinnedReady(url: string, tint: SkinTint = {}, hide: readonly string[] = []): boolean {
  return cache.has(cacheKey(url, tint, hide));
}

export interface SkinnedSource {
  url: string;
  tint?: SkinTint;
  hide?: string[];
}

/** Loads (and caches) every skinned override; call before rendering so clones below are synchronous. */
export function preloadSkinnedGlbs(sources: ReadonlyArray<SkinnedSource | string | null | undefined>): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const keys = new Set<string>();
  const list: Array<{ url: string; tint: SkinTint; hide: string[] }> = [];
  for (const s of sources) {
    const url = typeof s === 'string' ? s : s?.url;
    if (!url) continue;
    const tint = (typeof s === 'object' && s?.tint) || {};
    const hide = (typeof s === 'object' && s?.hide) || [];
    if (keys.has(cacheKey(url, tint, hide))) continue;
    keys.add(cacheKey(url, tint, hide));
    list.push({ url, tint, hide });
  }
  if (!list.length) return Promise.resolve();
  return Promise.all(list.map(({ url, tint, hide }) => ensureLoading(url, tint, hide))).then(() => undefined);
}

export interface SkinnedInstance {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<SkinState, THREE.AnimationAction>;
  current: SkinState | null;
  /** Death clip finished: freeze on its last frame. */
  settled: boolean;
}

/** A live clone of a loaded file (shares geometry/materials/clips), or null before load. */
export function cloneSkinned(url: string, tint: SkinTint = {}, hide: readonly string[] = []): SkinnedInstance | null {
  const baked = cache.get(cacheKey(url, tint, hide));
  if (!baked) {
    void ensureLoading(url, tint, hide);
    return null;
  }
  const group = cloneSkeleton(baked.scene) as THREE.Group;
  // Fresh clones carry stale bone matrices (Box3 of a SkinnedMesh reads them); refresh so
  // framing and thumbnails measure the posed model, like the renderer will.
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) m.skeleton.update();
  });
  const mixer = new THREE.AnimationMixer(group);
  const actions = new Map<SkinState, THREE.AnimationAction>();
  const names = baked.clips.map((c) => c.name);
  for (const state of Object.keys(KEYWORDS) as SkinState[]) {
    const name = pickClipName(names, state);
    const clip = name ? baked.clips.find((c) => c.name === name) : undefined;
    if (clip) actions.set(state, mixer.clipAction(clip));
  }
  // Whatever the file calls its clips, something must play: fill missing states from idle (or the first clip).
  if (actions.size > 0) {
    const any = actions.get('idle') ?? [...actions.values()][0];
    for (const state of Object.keys(KEYWORDS) as SkinState[]) if (!actions.has(state)) actions.set(state, any);
  } else if (baked.clips.length > 0) {
    const fallback = mixer.clipAction(baked.clips[0]);
    for (const state of Object.keys(KEYWORDS) as SkinState[]) actions.set(state, fallback);
  }
  return { group, mixer, actions, current: null, settled: false };
}

/** Frees what one clone owns: its skeleton's bone texture on the GPU and its animation state (geometry and materials belong to the shared cache). */
export function releaseSkinned(inst: SkinnedInstance): void {
  inst.mixer.stopAllAction();
  inst.mixer.uncacheRoot(inst.group);
  inst.group.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) m.skeleton.dispose();
  });
}

/** Crossfades to `state`. Death plays once and freezes (or freezes the current pose when the file has no death clip). */
export function setSkinState(inst: SkinnedInstance, state: SkinState): void {
  if (inst.current === state || inst.settled) return;
  const prev = inst.current ? inst.actions.get(inst.current) : undefined;
  inst.current = state;
  const next = inst.actions.get(state);
  if (!next) {
    // No clip for this state at all: freeze the current pose (used for death fallbacks).
    if (state === 'death') {
      inst.mixer.stopAllAction();
      inst.settled = true;
    }
    return;
  }
  if (state === 'death') {
    if (prev) prev.fadeOut(0.15);
    next.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(1);
    next.clampWhenFinished = true;
    next.fadeIn(0.1).play();
    return;
  }
  next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1);
  next.clampWhenFinished = false;
  next.fadeIn(0.18).play();
  if (prev && prev !== next) prev.fadeOut(0.18);
}

/** Advances the mixer; freezes a finished death clip on its last frame. */
export function stepSkin(inst: SkinnedInstance, dt: number): void {
  if (inst.settled || dt <= 0) return;
  inst.mixer.update(dt);
  if (inst.current === 'death') {
    const a = inst.actions.get('death');
    if (a && a.time >= a.getClip().duration - 1e-3) {
      inst.settled = true;
      a.paused = true;
    }
  }
}
