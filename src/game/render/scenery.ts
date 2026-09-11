// Instanced scenery (trees, rocks, bushes) + decorative grass tufts.
import * as THREE from 'three';
import type { AssetDef } from '@/shared/schema';
import { getSceneryGeometry } from '../models';
import { Rng } from '../sim/rng';
import type { Terrain } from '../sim/terrain';

const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });

export function createScenery(terrain: Terrain, assets: ReadonlyMap<string, AssetDef>): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scenery';
  const buckets = new Map<string, THREE.Matrix4[]>();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const o of terrain.obstacles) {
    const key = `${o.assetId}|${o.variant}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    q.setFromAxisAngle(up, o.yaw * Math.PI * 2);
    m.compose(new THREE.Vector3(o.x, o.y - 0.05, o.z), q, new THREE.Vector3(o.scale, o.scale, o.scale));
    list.push(m.clone());
  }
  for (const [key, list] of buckets) {
    const [assetId, variant] = key.split('|');
    const asset = assets.get(assetId);
    if (!asset) continue;
    const inst = new THREE.InstancedMesh(getSceneryGeometry(asset, Number(variant)), material, list.length);
    list.forEach((mat, i) => inst.setMatrixAt(i, mat));
    inst.castShadow = asset.kind !== 'bush';
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    inst.name = `scenery-${key}`;
    group.add(inst);
  }
  group.add(createGrass(terrain));
  return group;
}

function createGrass(terrain: Terrain): THREE.InstancedMesh {
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
  const count = Math.min(9000, Math.round((terrain.size * terrain.size) / 3.2));
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
