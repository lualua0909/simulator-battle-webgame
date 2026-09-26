// Animated barracks GLB (nha-linh.glb): keeps the file's node hierarchy + clips so the
// Door_OpenClose action can play each time the barracks spawns a unit.
// Static-rig structures normally bake to one vertex-coloured mesh (see glbStatic.ts),
// which would merge the Door into the house and lose the action — barracks therefore
// renders as live clones here instead of instanced parts (see render/units.ts).
// The file is fixed: the old procedural barracks was deleted, so the battle and every
// preview resolve the barracks to this URL without depending on the CMS database.
/** Fixed GLB file every barracks (nhà lính) resolves to. */
export const BARRACKS_GLB_URL = '/models/nha-linh.glb';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { getGLTFLoader } from './gltfLoader';

export interface BarracksInstance {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  door: THREE.AnimationAction | null;
}

interface Cached {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<void>>();

function groundOffset(scene: THREE.Group): THREE.Vector3 {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  return new THREE.Vector3(-center.x, -box.min.y, -center.z);
}

async function loadOne(url: string): Promise<void> {
  const gltf = await getGLTFLoader().loadAsync(url);
  // Keep grounding inside a placement root: the battle renderer overwrites the
  // returned group's position/rotation/scale every frame.
  const scene = new THREE.Group();
  const grounded = new THREE.Group();
  grounded.add(gltf.scene);
  grounded.position.copy(groundOffset(grounded));
  scene.add(grounded);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
  });
  cache.set(url, { scene, clips: gltf.animations ?? [] });
}

function ensureLoading(url: string): Promise<void> {
  let p = pending.get(url);
  if (!p) {
    p = loadOne(url).catch((err) => {
      console.error(`barracks glb load failed: ${url}`, err);
    });
    pending.set(url, p);
  }
  return p;
}

/** Loads every barracks override; call before rendering so clones below are synchronous. */
export function preloadBarracksGlbs(urls: ReadonlyArray<string | null | undefined>): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const list = [...new Set(urls.filter((u): u is string => !!u))].filter((u) => !cache.has(u));
  if (!list.length) return Promise.resolve();
  return Promise.all(list.map(ensureLoading)).then(() => undefined);
}

export function barracksReady(url: string): boolean {
  return cache.has(url);
}

/** Door clip: prefers a door/open action, else the first clip. Pure — unit-tested via name match. */
export function pickDoorClipName(names: readonly string[]): string | null {
  const low = names.map((n) => n.toLowerCase());
  let i = low.findIndex((n) => n.includes('door'));
  if (i < 0) i = low.findIndex((n) => n.includes('open'));
  if (i < 0) i = names.length > 0 ? 0 : -1;
  return i >= 0 ? names[i] : null;
}

/** A live clone of a loaded barracks file (shares geometry/materials/clips), or null before load. */
export function cloneBarracks(url: string): BarracksInstance | null {
  const baked = cache.get(url);
  if (!baked) {
    void ensureLoading(url);
    return null;
  }
  const group = cloneSkeleton(baked.scene) as THREE.Group;
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) m.skeleton.update();
  });
  const mixer = new THREE.AnimationMixer(group);
  const doorName = pickDoorClipName(baked.clips.map((c) => c.name));
  const clip = doorName ? baked.clips.find((c) => c.name === doorName) : undefined;
  const door = clip ? mixer.clipAction(clip) : null;
  if (door) {
    door.setLoop(THREE.LoopOnce, 1);
    door.clampWhenFinished = true;
  }
  return { group, mixer, door };
}

/** Restarts the door open/close action (each barracks spawn calls this). */
export function playBarracksDoor(inst: BarracksInstance): void {
  if (!inst.door) return;
  inst.door.reset().setLoop(THREE.LoopOnce, 1);
  inst.door.clampWhenFinished = true;
  inst.door.play();
}

/** Advances the door mixer. */
export function stepBarracks(inst: BarracksInstance, dt: number): void {
  if (dt <= 0) return;
  inst.mixer.update(dt);
}

/** Frees what one clone owns (geometry/materials belong to the shared cache). */
export function releaseBarracks(inst: BarracksInstance): void {
  inst.mixer.stopAllAction();
  inst.mixer.uncacheRoot(inst.group);
  inst.group.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) m.skeleton.dispose();
  });
}
