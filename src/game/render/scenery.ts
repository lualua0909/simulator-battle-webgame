// Instanced scenery (trees, rocks, bushes) + decorative grass tufts.
import * as THREE from 'three';
import type { AssetDef } from '@/shared/schema';
import { getSceneryGeometry } from '../models';
import { Rng } from '../sim/rng';
import type { Terrain } from '../sim/terrain';
import { getGLTFLoader } from '../models/gltfLoader';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getAnimatedGlb, type AnimatedGlb } from '../models/glbStatic';
import { AnimatedTrees, type TreePlacement } from './animatedTrees';

/** Trees never read smaller than this (m); a soldier stands ~1.8 m. */
const MIN_TREE_HEIGHT = 4;
const GRASS_AMOUNT = 0.1;

const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
const GRASS_GLB_URL = '/models/grass.glb';
let grassGeometry: THREE.BufferGeometry | null = null;
let grassMaterial: THREE.Material | null = null;
let grassUnitScale = 1;
let grassPending: Promise<void> | null = null;

/** Preloads the shared grass mesh before a map is created. */
export function preloadGrass(): Promise<void> {
  if (typeof window === 'undefined' || grassGeometry) return Promise.resolve();
  if (!grassPending) {
    grassPending = getGLTFLoader().loadAsync(GRASS_GLB_URL).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const sources: THREE.Mesh[] = [];
      gltf.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) sources.push(object);
      });
      if (sources.length === 0) throw new Error('grass.glb không có mesh');
      const geometries = sources.map((source) => {
        const geometry = source.geometry.clone();
        geometry.applyMatrix4(source.matrixWorld);
        return geometry;
      });
      const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
      if (!geometry) throw new Error('không thể gộp các mesh trong grass.glb');
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      const height = box.max.y - box.min.y;
      if (height > 0) grassUnitScale = 1 / height;
      grassGeometry = geometry;
      const sourceMaterial = sources[0].material;
      grassMaterial = Array.isArray(sourceMaterial) ? sourceMaterial[0].clone() : sourceMaterial.clone();
      grassMaterial.side = THREE.DoubleSide;
    }).catch((error) => {
      console.error(`grass GLB load failed: ${GRASS_GLB_URL}`, error);
    });
  }
  return grassPending;
}

/** The scenery group plus its animated trees, which the engine ticks each frame and disposes with the map. */
export class SceneryGroup extends THREE.Group {
  trees: AnimatedTrees[] = [];
}

export function createScenery(terrain: Terrain, assets: ReadonlyMap<string, AssetDef>): SceneryGroup {
  const group = new SceneryGroup();
  group.name = 'scenery';
  const buckets = new Map<string, Terrain['obstacles']>();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const animatedTrees = new Map<string, { source: AnimatedGlb; placements: TreePlacement[] }>();
  for (const o of terrain.obstacles) {
    const key = `${o.assetId}|${o.variant}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(o);
  }
  for (const [key, list] of buckets) {
    const [assetId, variant] = key.split('|');
    const asset = assets.get(assetId);
    if (!asset) continue;
    const geometry = getSceneryGeometry(asset, Number(variant));
    // Trees: fit the model to its configured height (whatever the source mesh size), keeping the per-instance jitter.
    let fit = 1;
    if (asset.kind === 'tree') {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const h = geometry.boundingBox!.max.y - geometry.boundingBox!.min.y;
      const target = Math.max(MIN_TREE_HEIGHT, (asset.params as { height?: number }).height ?? 6);
      if (h > 0) fit = target / (h * (asset.scale || 1));
    }
    // A tree glb with skeletal clips (cay-thong-animation.glb) sways instead of standing baked.
    const animated = asset.kind === 'tree' && asset.glb ? getAnimatedGlb(asset.glb.url) : undefined;
    if (animated) {
      let entry = animatedTrees.get(assetId);
      if (!entry) animatedTrees.set(assetId, (entry = { source: animated, placements: [] }));
      for (const o of list) {
        const s = o.scale * fit;
        q.setFromAxisAngle(up, o.yaw * Math.PI * 2);
        entry.placements.push({ x: o.x, z: o.z, radius: o.radius, matrix: new THREE.Matrix4().compose(new THREE.Vector3(o.x, o.y - 0.05, o.z), q, new THREE.Vector3(s, s, s)) });
      }
      continue;
    }
    const inst = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((o, i) => {
      const s = o.scale * fit;
      q.setFromAxisAngle(up, o.yaw * Math.PI * 2);
      m.compose(new THREE.Vector3(o.x, o.y - 0.05, o.z), q, new THREE.Vector3(s, s, s));
      inst.setMatrixAt(i, m);
    });
    inst.castShadow = asset.kind !== 'bush';
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    inst.name = `scenery-${key}`;
    group.add(inst);
  }
  // Variants share the glb, so every placement of an animated tree goes into one set of wind bands.
  for (const [assetId, { source, placements }] of animatedTrees) {
    const trees = new AnimatedTrees(source, material, placements, -terrain.half, terrain.half, assetId);
    group.trees.push(trees);
    group.add(trees.group);
  }
  group.add(createGrass(terrain));
  return group;
}

function createGrass(terrain: Terrain): THREE.InstancedMesh {
  const sourceGeometry = grassGeometry;
  if (sourceGeometry && grassMaterial) return createGlbGrass(terrain, sourceGeometry, grassMaterial);
  const blade = new THREE.BufferGeometry();
  const tri: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const dx = Math.cos(a) * 0.09;
    const dz = Math.sin(a) * 0.09;
    const lean = Math.cos(a + 1) * 0.08;
    tri.push(-dz * 0.4, 0, dx * 0.4, dz * 0.4, 0, -dx * 0.4, dx + lean, 0.34, dz);
  }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  blade.computeVertexNormals();
  const count = Math.min(12000, Math.round((terrain.size * terrain.size) / 1.2 * grassDensity(terrain) * GRASS_AMOUNT));
  // Unlit: thin two-sided blades otherwise read as black specks from above.
  const inst = new THREE.InstancedMesh(blade, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), count);
  const rng = new Rng(terrain.map.seed + 991);
  const base = new THREE.Color(terrain.map.grassColor);
  const c = new THREE.Color();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let placed = 0;
  for (let attempt = 0; attempt < count * 2 && placed < count; attempt++) {
    const x = rng.range(-terrain.half + 1, terrain.half - 1);
    const z = rng.range(-terrain.half + 1, terrain.half - 1);
    if (terrain.riverDistance(x, z) < terrain.riverHalfWidth + 1.5) continue;
    const s = 0.7 + rng.next() * 0.9;
    q.setFromAxisAngle(up, rng.next() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, terrain.height(x, z) - 0.02, z), q, new THREE.Vector3(s, s * (0.8 + rng.next() * 0.6), s));
    inst.setMatrixAt(placed, m);
    c.copy(base).offsetHSL((rng.next() - 0.5) * 0.05, 0.02, (rng.next() - 0.5) * 0.1);
    inst.setColorAt(placed, c);
    placed++;
  }
  inst.count = placed;
  inst.receiveShadow = true;
  inst.computeBoundingSphere();
  inst.name = 'grass';
  return inst;
}

function createGlbGrass(terrain: Terrain, geometry: THREE.BufferGeometry, sourceMaterial: THREE.Material): THREE.InstancedMesh {
  const count = Math.min(6000, Math.round((terrain.size * terrain.size) / 2.2 * grassDensity(terrain) * GRASS_AMOUNT));
  const inst = new THREE.InstancedMesh(geometry, sourceMaterial, count);
  const rng = new Rng(terrain.map.seed + 991);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let placed = 0;
  for (let attempt = 0; attempt < count * 2 && placed < count; attempt++) {
    const x = rng.range(-terrain.half + 1, terrain.half - 1);
    const z = rng.range(-terrain.half + 1, terrain.half - 1);
    if (terrain.riverDistance(x, z) < terrain.riverHalfWidth + 1.5) continue;
    const s = grassUnitScale * (0.8 + rng.next() * 0.5);
    q.setFromAxisAngle(up, rng.next() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, terrain.height(x, z) - 0.02, z), q, new THREE.Vector3(s, s * (0.85 + rng.next() * 0.3), s));
    inst.setMatrixAt(placed++, m);
  }
  inst.count = placed;
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.computeBoundingSphere();
  inst.name = 'grass-glb';
  return inst;
}

/** Sparse grass makes the biome silhouettes read clearly. */
function grassDensity(terrain: Terrain): number {
  switch (terrain.map.id) {
    case 'thanh-tren-doi':
      return 0.28;
    case 'thanh-tuyet':
      return 0.1;
    case 'sa-mac':
      return 0.04;
    case 'mini-map':
      return 0.2;
    default:
      return 0.35;
  }
}
