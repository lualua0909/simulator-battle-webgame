// Diorama map (KayKit Medieval Hexagon look): the square field built from hex tile columns on
// terraces, a border ring of mountains, forests and each side's castle, scenery swapped for the
// pack's trees and rocks. Render only: the simulation sees Terrain.height() (flat hex tops).
// Every model comes from one packed kaykit-hex.glb (scripts/build-kaykit-glb.ts) on one shared
// palette texture, so the whole diorama bakes into two static meshes (tiles, shadow casters).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getGLTFLoader } from '../models/gltfLoader';
import { hash2 } from '../sim/rng';
import { HEX_RADIUS, HEX_STEP, HEX_WIDTH, type Side, type Terrain } from '../sim/terrain';
import { FORESTS, MOUNTAINS, ROCKS, TREES, castleModel, towerModel } from './kaykitModels';

const PACK_URL = '/models/kaykit-hex.glb';

interface Piece {
  /** Float, non-quantized, in the model's own space. */
  geometry: THREE.BufferGeometry;
  /** Local y extent of the geometry. */
  minY: number;
  maxY: number;
}

interface Pack {
  pieces: Map<string, Piece>;
  texture: THREE.Texture;
}

let pack: Promise<Pack> | null = null;

/** Plain float copy of an attribute (the pack's meshopt-quantized ints cannot be transformed in place). */
function toFloat(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
  return new THREE.BufferAttribute(out, a.itemSize);
}

function loadPack(): Promise<Pack> {
  pack ??= getGLTFLoader()
    .loadAsync(PACK_URL)
    .then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const pieces = new Map<string, Piece>();
      let texture: THREE.Texture | null = null;
      for (const root of gltf.scene.children) {
        const parts: THREE.BufferGeometry[] = [];
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          texture ??= (mesh.material as THREE.MeshStandardMaterial).map;
          const g = new THREE.BufferGeometry();
          for (const key of ['position', 'normal', 'uv']) g.setAttribute(key, toFloat(mesh.geometry.getAttribute(key)));
          g.setIndex(mesh.geometry.index ? Array.from(mesh.geometry.index.array) : null);
          // Quantized meshes carry their dequantize scale/offset on the node: bake it in.
          g.applyMatrix4(mesh.matrixWorld);
          parts.push(g);
        });
        const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts)!;
        geometry.computeBoundingBox();
        pieces.set(root.name, { geometry, minY: geometry.boundingBox!.min.y, maxY: geometry.boundingBox!.max.y });
      }
      if (!texture) throw new Error('KayKit pack has no texture');
      return { pieces, texture };
    });
  return pack;
}

/** Collects placements per model, then bakes them all into two static meshes once the pack is loaded. */
class Batch {
  private readonly items: Array<{ name: string; m: THREE.Matrix4 }> = [];
  private readonly columns: Array<{ name: string; x: number; z: number; top: number; bottom: number }> = [];

  add(name: string, x: number, y: number, z: number, scale: number, yaw: number): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(scale, scale, scale),
    );
    this.items.push({ name, m });
  }

  /** A tile stretched vertically so its top sits at `top` and its foot at `bottom` (the pack's palette UVs stretch cleanly). */
  column(name: string, x: number, z: number, top: number, bottom: number): void {
    this.columns.push({ name, x, z, top, bottom });
  }

  build(group: THREE.Group): void {
    loadPack()
      .then(({ pieces, texture }) => {
        const tiles: THREE.BufferGeometry[] = [];
        const props: THREE.BufferGeometry[] = [];
        const s = HEX_WIDTH / 2;
        for (const c of this.columns) {
          const piece = pieces.get(c.name);
          if (!piece) continue;
          const sy = (c.top - c.bottom) / (piece.maxY - piece.minY);
          tiles.push(piece.geometry.clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(c.x, c.top - piece.maxY * sy, c.z), new THREE.Quaternion(), new THREE.Vector3(s, sy, s))));
        }
        for (const { name, m } of this.items) {
          const piece = pieces.get(name);
          if (piece) props.push(piece.geometry.clone().applyMatrix4(m));
        }
        // Emissive from the palette itself lifts the pack's bright daylight colours back through ACES tone mapping.
        const material = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#ffffff', emissiveIntensity: 0.28, roughness: 0.85, metalness: 0 });
        for (const [list, name, cast] of [[tiles, 'diorama-tiles', false], [props, 'diorama-props', true]] as const) {
          if (list.length === 0) continue;
          const mesh = new THREE.Mesh(mergeGeometries(list), material);
          for (const g of list) g.dispose();
          mesh.name = name;
          mesh.castShadow = cast;
          mesh.receiveShadow = true;
          group.add(mesh);
        }
      })
      .catch((e) => console.warn(e));
  }
}

export function createDiorama(terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  group.name = 'diorama';
  const batch = new Batch();
  const half = terrain.half;
  const seed = terrain.map.seed;
  const scale = HEX_WIDTH / 2;
  const rowH = HEX_RADIUS * 1.5;
  const reach = half + HEX_WIDTH * 1.6;
  const rows = Math.ceil(reach / rowH);
  const cols = Math.ceil(reach / HEX_WIDTH) + 1;
  const bottom = terrain.islandFloor + 2;
  const quant = (h: number) => Math.round(h / HEX_STEP) * HEX_STEP;
  const lim = half + 1e-6;

  // Castles stand on the border ring behind each side's deployment zone.
  const castleAt = new Map<string, Side>();
  for (const side of terrain.activeSides) {
    const z = terrain.zoneOf(side);
    const cx = (z.x0 + z.x1) / 2;
    const cz = (z.z0 + z.z1) / 2;
    const k = (half + HEX_WIDTH * 0.8) / Math.max(Math.abs(cx), Math.abs(cz), 1e-6);
    castleAt.set(`${Math.round(cx * k)},${Math.round(cz * k)}`, side);
  }
  const castles: Array<{ x: number; z: number; side: Side }> = [];
  const border: Array<{ x: number; z: number; top: number; i: number; j: number }> = [];

  for (let j = -rows; j <= rows; j++) {
    const z = j * rowH;
    const off = (j & 1) === 0 ? 0 : HEX_WIDTH / 2;
    for (let i = -cols; i <= cols; i++) {
      const x = i * HEX_WIDTH + off;
      const inside = Math.abs(x) <= lim && Math.abs(z) <= lim;
      if (!inside && (Math.abs(x) > reach || Math.abs(z) > reach)) continue;
      if (inside) {
        const top = terrain.height(x, z);
        if (terrain.inWater(x, z)) {
          batch.column('hex_grass', x, z, top, bottom);
          batch.column('hex_water', x, z, terrain.waterLevel, top);
        } else batch.column('hex_grass', x, z, top, bottom);
        continue;
      }
      // Border ring: raised a step above the nearest edge of the field.
      const ex = Math.max(-half, Math.min(half, x));
      const ez = Math.max(-half, Math.min(half, z));
      const top = quant(Math.max(terrain.height(ex, ez), terrain.riverEnabled && terrain.inWater(ex, ez) ? terrain.waterLevel : -Infinity)) + HEX_STEP;
      batch.column('hex_grass', x, z, top, bottom);
      border.push({ x, z, top, i, j });
    }
  }

  for (const b of border) {
    let best: Side | undefined;
    let bestD = Infinity;
    for (const [key, side] of castleAt) {
      const [cx, cz] = key.split(',').map(Number);
      const d = (cx - b.x) ** 2 + (cz - b.z) ** 2;
      if (d < bestD) (bestD = d), (best = side);
    }
    if (best && bestD < HEX_WIDTH * HEX_WIDTH && !castles.some((c) => c.side === best)) {
      castles.push({ x: b.x, z: b.z, side: best });
      // Face the field.
      batch.add(castleModel(best), b.x, b.top, b.z, scale, Math.atan2(-b.x, -b.z));
    }
  }
  for (const b of border) {
    if (castles.some((c) => c.x === b.x && c.z === b.z)) continue;
    const yaw = Math.floor(hash2(b.i, b.j, seed + 5) * 6) * (Math.PI / 3);
    const keep = castles.find((c) => (c.x - b.x) ** 2 + (c.z - b.z) ** 2 < (HEX_WIDTH * 1.2) ** 2);
    if (keep) {
      if (hash2(b.i, b.j, seed + 9) < 0.5) batch.add(towerModel(keep.side), b.x, b.top, b.z, scale, yaw);
      continue;
    }
    const roll = hash2(b.i, b.j, seed + 1);
    // The far rows (±z) carry the mountain range, the rest forests and open grass.
    const pool = Math.abs(b.z) > half && roll < 0.75 ? MOUNTAINS : roll < 0.55 ? FORESTS : null;
    if (pool) batch.add(pool[Math.floor(hash2(b.i, b.j, seed + 2) * pool.length)], b.x, b.top, b.z, scale, yaw);
  }

  // Field scenery: the pack's trees and rocks where the terrain placed obstacles (bushes stay out: clean tiles).
  for (const o of terrain.obstacles) {
    const pick = Math.floor(o.yaw * 997) % 1000;
    if (o.kind === 'tree') batch.add(TREES[pick % TREES.length], o.x, o.y, o.z, scale * (0.8 + (pick % 7) * 0.06), o.yaw * Math.PI * 2);
    else if (o.kind === 'rock') batch.add(ROCKS[pick % ROCKS.length], o.x, o.y, o.z, scale * 3 * Math.max(0.6, Math.min(1.6, o.scale)), o.yaw * Math.PI * 2);
  }

  batch.build(group);
  return group;
}
