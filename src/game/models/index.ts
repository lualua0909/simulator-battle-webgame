// Asset preset → procedural model, plus unit composition (mount + rider) and template cache.
import * as THREE from 'three';
import { parseAssetParams, type AssetDef, type UnitDef } from '@/shared/schema';
import { bakeModel, mergeTemplate, type ModelTemplate } from './bake';
import { createCatapultModel } from './catapult';
import { createDragonModel } from './dragon';
import { createElephantModel } from './elephant';
import { createEquipmentModel, equipmentKey, itemOf, legacyEquipment, mountEquipment, unitEquipment, type EquipItem } from './equipment';
import { createTreeModel } from './environment';
import { createHorseModel } from './horse';
import { createHumanoidModel, HIP_Y } from './humanoid';
import { getCustomGlbGroup } from './glbStatic';
import { BARRACKS_GLB_URL } from './barracksGlb';
import { modelRoot } from './common';
import { createRaptorModel } from './raptor';
import { createStructureModel } from './structures';
import { SKINNED_GLB_KINDS } from '@/shared/schema';

export type { ModelTemplate } from './bake';

/**
 * `equipment`: items a humanoid carries (models/equipment.ts); omitted = its legacy built-in
 * weapon, so a bare character asset still previews as before.
 */
export function createAssetModel(asset: AssetDef, seedOverride?: number, equipment?: readonly EquipItem[]): THREE.Group {
  const seed = seedOverride ?? asset.seed;
  let root: THREE.Group;
  // An admin-uploaded glb/gltf replaces the procedural preset (static-rig kinds only;
  // see assetSchema). Skinned kinds (SKINNED_GLB_KINDS) skip this baked path: the battle renderer plays the file's
  // skeletal clips instead, and everything else falls back to the procedural model below.
  // Wall blocks (wall/brick-wall) never use glb: they are lightweight Three.js boxes.
  // Barracks (nhà lính) always resolves to its fixed GLB file — the old procedural
  // barracks was deleted. Baked here for ghosts/thumbnails/previews; the battle renders
  // live clones with the door action (see models/barracksGlb.ts, render/units.ts).
  const barracksLook = asset.kind === 'structure' && (asset.params as Record<string, unknown> | undefined)?.type === 'barracks';
  if (barracksLook) {
    const baked = getCustomGlbGroup(BARRACKS_GLB_URL, asset.kind);
    if (baked) {
      baked.scale.setScalar(asset.scale);
      baked.userData.assetId = asset.id;
      return baked;
    }
    const empty = new THREE.Group();
    empty.userData.assetId = asset.id;
    return empty;
  }
  const skinned = (SKINNED_GLB_KINDS as readonly string[]).includes(asset.kind);
  const wallLook = asset.kind === 'structure' && ((asset.params as Record<string, unknown> | undefined)?.type === 'wall' || (asset.params as Record<string, unknown> | undefined)?.type === 'brick-wall');
  const uploaded = !skinned && !wallLook && asset.glb ? getCustomGlbGroup(asset.glb.url, asset.kind) : undefined;
  if (uploaded) {
    uploaded.scale.setScalar(asset.scale);
    uploaded.userData.assetId = asset.id;
    return uploaded;
  }
  switch (asset.kind) {
    case 'humanoid':
      root = createHumanoidModel(parseAssetParams('humanoid', asset.params));
      mountEquipment(root, equipment ?? legacyEquipment(asset));
      break;
    case 'equipment': {
      // Standalone preview, upright in its item frame (the asset scale lands on the root below).
      root = modelRoot('equipment', 'static');
      const model = createEquipmentModel({ ...itemOf(asset, 'handR'), scale: 1, glbUrl: null });
      if (model) root.add(model);
      break;
    }
    case 'horse':
      root = createHorseModel(parseAssetParams('horse', asset.params));
      break;
    case 'elephant':
      root = createElephantModel(parseAssetParams('elephant', asset.params), seed);
      break;
    case 'dragon': {
      const dp = parseAssetParams('dragon', asset.params);
      // Rồng lửa (western) is GLB-only: its procedural builder was deleted, so an
      // uploaded file bakes to nothing here — the battle renders the file's skeletal
      // clips instead (see skinUrlFor in render/units.ts). Rồng Xanh (type baby)
      // keeps its procedural fallback below.
      if (dp.type !== 'baby' && asset.glb) {
        const empty = new THREE.Group();
        empty.userData.assetId = asset.id;
        root = empty;
        break;
      }
      root = createDragonModel(dp);
      break;
    }
    case 'bird':
      // Flying stingray is GLB-only; skeletal clips are rendered by glbSkinned.
      root = new THREE.Group();
      break;
    case 'raptor':
      root = createRaptorModel(parseAssetParams('raptor', asset.params));
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
    case 'bush':
      // GLB-only: the procedural rock/bush builders were deleted, so without an upload there is nothing to draw.
      root = new THREE.Group();
      break;
  }
  root.scale.setScalar(asset.scale);
  root.userData.assetId = asset.id;
  return root;
}

/** Mount + optional rider seated on the mount's `saddle` socket, carrying the unit's equipment. */
export function createUnitModel(unit: Pick<UnitDef, 'modelId' | 'riderModelId'> & { equipment?: UnitDef['equipment'] }, assets: ReadonlyMap<string, AssetDef>): THREE.Group {
  const base = assets.get(unit.modelId);
  const gear = unitEquipment(unit, assets);
  const root = base ? createAssetModel(base, undefined, gear.model) : fallbackModel();
  const riderAsset = unit.riderModelId ? assets.get(unit.riderModelId) : undefined;
  if (riderAsset) {
    let saddle: THREE.Object3D | undefined;
    root.traverse((o) => {
      if (o.userData.socket === 'saddle') saddle = o;
    });
    if (saddle) {
      const rider = createAssetModel(riderAsset, undefined, gear.rider);
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
  const gear = unitEquipment(unit, assets);
  const key = `${unit.id}|${JSON.stringify(assets.get(unit.modelId))}|${JSON.stringify(unit.riderModelId ? assets.get(unit.riderModelId) : null)}|${equipmentKey(gear.model)}|${equipmentKey(gear.rider)}`;
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
