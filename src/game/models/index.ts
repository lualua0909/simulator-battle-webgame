// Asset preset → procedural model, plus unit composition (mount + rider) and template cache.
import * as THREE from 'three';
import { parseAssetParams, type AssetDef, type UnitDef } from '@/shared/schema';
import { buildSculptModel } from '../sculpt/build';
import { bakeModel, mergeTemplate, type ModelTemplate } from './bake';
import { createBirdModel } from './bird';
import { createCatapultModel } from './catapult';
import { createDragonModel } from './dragon';
import { createElephantModel } from './elephant';
import { createBushModel, createRockModel, createTreeModel } from './environment';
import { createHorseModel } from './horse';
import { createHumanoidModel, HIP_Y } from './humanoid';
import { getCustomGlbGroup } from './glbStatic';
import { createStructureModel } from './structures';

export type { ModelTemplate } from './bake';

export function createAssetModel(asset: AssetDef, seedOverride?: number): THREE.Group {
  const seed = seedOverride ?? asset.seed;
  let root: THREE.Group;
  // An img2threejs studio model replaces the procedural preset.
  if (asset.sculpt) {
    root = buildSculptModel(asset.sculpt.spec);
    root.scale.setScalar(asset.scale);
    root.userData.assetId = asset.id;
    return root;
  }
  // An admin-uploaded glb/gltf replaces the procedural preset (static-rig kinds only; see assetSchema).
  const uploaded = asset.glb ? getCustomGlbGroup(asset.glb.url) : undefined;
  if (uploaded) {
    uploaded.scale.setScalar(asset.scale);
    uploaded.userData.assetId = asset.id;
    return uploaded;
  }
  switch (asset.kind) {
    case 'humanoid':
      root = createHumanoidModel(parseAssetParams('humanoid', asset.params));
      break;
    case 'horse':
      root = createHorseModel(parseAssetParams('horse', asset.params));
      break;
    case 'elephant':
      root = createElephantModel(parseAssetParams('elephant', asset.params), seed);
      break;
    case 'dragon':
      root = createDragonModel(parseAssetParams('dragon', asset.params));
      break;
    case 'bird':
      root = createBirdModel(parseAssetParams('bird', asset.params));
      break;
    case 'catapult':
      root = createCatapultModel(parseAssetParams('catapult', asset.params));
      break;
    case 'structure':
      root = createStructureModel(parseAssetParams('structure', asset.params), seed);
      break;
    case 'tree':
      root = createTreeModel(parseAssetParams('tree', asset.params), seed);
      break;
    case 'rock':
      root = createRockModel(parseAssetParams('rock', asset.params), seed);
      break;
    case 'bush':
      root = createBushModel(parseAssetParams('bush', asset.params), seed);
      break;
  }
  root.scale.setScalar(asset.scale);
  root.userData.assetId = asset.id;
  return root;
}

/** Mount + optional rider seated on the mount's `saddle` socket. */
export function createUnitModel(unit: Pick<UnitDef, 'modelId' | 'riderModelId'>, assets: ReadonlyMap<string, AssetDef>): THREE.Group {
  const base = assets.get(unit.modelId);
  const root = base ? createAssetModel(base) : fallbackModel();
  const riderAsset = unit.riderModelId ? assets.get(unit.riderModelId) : undefined;
  if (riderAsset) {
    let saddle: THREE.Object3D | undefined;
    root.traverse((o) => {
      if (o.userData.socket === 'saddle') saddle = o;
    });
    if (saddle) {
      const rider = createAssetModel(riderAsset);
      rider.userData.prefix = 'rider.';
      // Socket marks where the rider's hips sit; undo the mount's scale for the rider.
      const mountScale = base?.scale ?? 1;
      const hipY = rider.children.find((c) => c.userData.part === 'hips')?.position.y ?? HIP_Y;
      rider.scale.setScalar(riderAsset.scale / mountScale);
      rider.position.y = (-hipY * riderAsset.scale) / mountScale;
      saddle.add(rider);
    }
  }
  return root;
}

function fallbackModel(): THREE.Group {
  const g = new THREE.Group();
  g.userData.rig = 'static';
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), new THREE.MeshStandardMaterial({ color: '#ff00ff' }));
  m.position.y = 0.9;
  m.name = 'missing-asset';
  g.add(m);
  return g;
}

const unitCache = new Map<string, ModelTemplate>();

export function getUnitTemplate(unit: UnitDef, assets: ReadonlyMap<string, AssetDef>): ModelTemplate {
  const key = `${unit.id}|${JSON.stringify(assets.get(unit.modelId))}|${JSON.stringify(unit.riderModelId ? assets.get(unit.riderModelId) : null)}`;
  let t = unitCache.get(key);
  if (!t) {
    t = bakeModel(createUnitModel(unit, assets));
    unitCache.set(key, t);
  }
  return t;
}

const sceneryCache = new Map<string, THREE.BufferGeometry>();

/** Merged rest geometry for scenery (one InstancedMesh per variant). */
export function getSceneryGeometry(asset: AssetDef, variant: number): THREE.BufferGeometry {
  const key = `${JSON.stringify(asset)}|${variant}`;
  let g = sceneryCache.get(key);
  if (!g) {
    const root = createAssetModel({ ...asset, scale: 1 }, asset.seed * 10 + variant);
    g = mergeTemplate(bakeModel(root));
    sceneryCache.set(key, g);
  }
  return g;
}
