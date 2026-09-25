// Unit portrait thumbnails rendered from the real models (one shared context).
// Skinned units (uploaded skeletal .glb) pose from the file itself — the same source the
// battle renders — with the procedural model as the fallback before the file arrives.
import * as THREE from 'three';
import { SKINNED_GLB_KINDS, type AssetDef, type ConfigBundle, type UnitDef, type WeaponDef } from '@/shared/schema';
import { getUnitTemplate } from '../models';
import { cloneSkinned, type SkinTint } from '../models/glbSkinned';
import { attackStyleFor, Poser } from './animate';

const cache = new Map<string, Promise<Record<string, string>>>();

export function unitThumbnails(bundle: ConfigBundle): Promise<Record<string, string>> {
  let p = cache.get(bundle.version);
  if (!p) {
    p = render(bundle);
    cache.set(bundle.version, p);
  }
  return p;
}

function skinnedUrlOf(asset: { kind: string; glb: { url: string } | null } | undefined): string | null {
  return asset?.glb && (SKINNED_GLB_KINDS as readonly string[]).includes(asset.kind) ? asset.glb.url : null;
}

/** Renders one skinned unit mid-idle into the shared context; false before its file loads. */
async function renderSkinned(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, url: string, scale: number, tint?: SkinTint, hide?: string[]): Promise<boolean> {
  const inst = cloneSkinned(url, tint ?? {}, hide ?? []);
  if (!inst) return false;
  try {
    inst.group.scale.setScalar(scale);
    inst.actions.get('idle')?.play();
    inst.mixer.update(0.6);
    inst.group.updateMatrixWorld(true);
    scene.add(inst.group);
    const b = new THREE.Box3().setFromObject(inst.group);
    if (b.isEmpty()) return false;
    const center = b.getCenter(new THREE.Vector3());
    const radius = b.getSize(new THREE.Vector3()).length() * 0.5;
    const dist = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.02;
    camera.position.set(center.x + Math.sin(0.6) * dist, center.y + dist * 0.25, center.z + Math.cos(0.6) * dist);
    camera.lookAt(center);
    renderer.render(scene, camera);
    return true;
  } finally {
    scene.remove(inst.group);
  }
}

async function render(bundle: ConfigBundle): Promise<Record<string, string>> {
  const assets = new Map(bundle.assets.map((a) => [a.id, a]));
  const weapons = new Map(bundle.weapons.map((w) => [w.id, w]));
  // Portraits from earlier visits: a repeat visit opens no WebGL context and encodes no PNG.
  const keys = new Map(bundle.units.map((u) => [u.id, thumbKey(u, assets, weapons)]));
  const stored = await readStored([...keys.values()]);
  const out: Record<string, string> = {};
  const missing = bundle.units.filter((u) => {
    const hit = stored.get(keys.get(u.id)!);
    if (hit) out[u.id] = hit;
    return !hit;
  });
  if (missing.length === 0) return out;
  const fresh = new Map<string, string>();
  const size = 224;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#f2f8ff', '#6b5a3a', 1.8));
  const sun = new THREE.DirectionalLight('#fff4de', 2.4);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const smoothMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  for (const unit of missing) {
    const skinAsset = assets.get(unit.modelId);
    const skinUrl = skinnedUrlOf(skinAsset);
    if (skinUrl && (await renderSkinned(renderer, scene, camera, skinUrl, skinAsset?.scale ?? 1, skinAsset?.glb?.tint, skinAsset?.glb?.hide))) {
      out[unit.id] = renderer.domElement.toDataURL('image/png');
      fresh.set(keys.get(unit.id)!, out[unit.id]);
      await new Promise((r) => setTimeout(r, 0));
      continue;
    }
    const template = getUnitTemplate(unit, assets);
    const poses = template.parts.map(() => new THREE.Matrix4());
    new Poser(template, attackStyleFor(template, weapons.get(unit.weaponId))).compute(
      { time: 0.4, speed: 0, phase: 0, attack: -1, airborne: false, stunned: false, leanX: 0, leanZ: 0, seed: 0, refSpeed: 1 },
      poses,
    );
    const group = new THREE.Group();
    template.parts.forEach((p, i) => {
      if (!p.geometry) return;
      const m = new THREE.Mesh(p.geometry, template.smooth ? smoothMaterial : material);
      m.matrixAutoUpdate = false;
      m.matrix.copy(poses[i]);
      group.add(m);
    });
    scene.add(group);
    const b = template.bounds;
    const center = b.getCenter(new THREE.Vector3());
    const radius = b.getSize(new THREE.Vector3()).length() * 0.5;
    const dist = radius / Math.tan((camera.fov * Math.PI) / 360) * 1.02;
    camera.position.set(center.x + Math.sin(0.6) * dist, center.y + dist * 0.25, center.z + Math.cos(0.6) * dist);
    camera.lookAt(center);
    renderer.render(scene, camera);
    out[unit.id] = renderer.domElement.toDataURL('image/png');
    // A skinned unit drawn from its procedural fallback (file still loading) must not be kept.
    if (!skinUrl) fresh.set(keys.get(unit.id)!, out[unit.id]);
    scene.remove(group);
    await new Promise((r) => setTimeout(r, 0));
  }
  material.dispose();
  smoothMaterial.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  void writeStored(fresh);
  return out;
}

// ---------------------------------------------------------------- persistent cache (IndexedDB)

/** Changes with every build, so portraits of models whose code changed are redrawn. */
const BUILD = process.env.BUILD_STAMP ?? 'dev';
const DB_NAME = 'mbs-thumbnails';
const STORE = 'thumbs';

/** Everything a portrait depends on: the unit, its model and rider assets, its weapon (pose) and the build. */
function thumbKey(unit: UnitDef, assets: ReadonlyMap<string, AssetDef>, weapons: ReadonlyMap<string, WeaponDef>): string {
  const deps = JSON.stringify([unit, assets.get(unit.modelId) ?? null, unit.riderModelId ? assets.get(unit.riderModelId) ?? null : null, weapons.get(unit.weaponId) ?? null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < deps.length; i++) h = Math.imul(h ^ deps.charCodeAt(i), 0x01000193);
  return `${BUILD}:portrait224:${unit.id}:${(h >>> 0).toString(36)}`;
}

/** The cache is optional: private windows, blocked storage or old browsers just render every time. */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readStored(keys: readonly string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const db = await openDb();
  if (!db) return found;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      for (const key of keys) {
        const req = store.get(key);
        req.onsuccess = () => typeof req.result === 'string' && found.set(key, req.result);
      }
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
  return found;
}

/** Stores new portraits and drops those of earlier builds. */
async function writeStored(entries: ReadonlyMap<string, string>): Promise<void> {
  if (entries.size === 0) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const cursor = store.openKeyCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        if (!String(c.key).startsWith(`${BUILD}:`)) store.delete(c.key);
        c.continue();
      };
      for (const [key, url] of entries) store.put(url, key);
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
