// Faceted low-poly terrain, animated river surface and deployment-zone overlays.
import * as THREE from 'three';
import { hash2, valueNoise } from '../sim/rng';
import type { Side, Terrain } from '../sim/terrain';
import type { waterMaterial } from './webgpu';

/** Grid cells along each side of the terrain mesh (the skirt's bank samples the edge the same way). */
function terrainSegments(terrain: Terrain): number {
  return Math.min(200, Math.round(terrain.size / 0.85));
}

/**
 * Faceted ground builder: `emit` adds one triangle coloured like the terrain (grass, dirt patches,
 * rock on slopes, sand by the river). Shared by the square field and the floating island's top.
 */
export function groundTriangles(terrain: Terrain, triangles: number) {
  const map = terrain.map;
  const half = terrain.half;
  const pos = new Float32Array(triangles * 9);
  const col = new Float32Array(triangles * 9);
  const grass = new THREE.Color(map.grassColor);
  const grass2 = grass.clone().offsetHSL(0.025, 0.04, -0.07);
  const dirt = new THREE.Color(map.dirtColor);
  const sand = new THREE.Color(map.sandColor);
  const rock = new THREE.Color('#8a857c');
  const c = new THREE.Color();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  let k = 0;

  const emit = (ax: number, az: number, ay: number, bx: number, bz: number, by: number, cx: number, cz: number, cy: number) => {
    pos.set([ax, ay, az, bx, by, bz, cx, cy, cz], k);
    e1.set(bx - ax, by - ay, bz - az);
    e2.set(cx - ax, cy - ay, cz - az);
    const ny = Math.abs(e1.cross(e2).normalize().y);
    const mx = (ax + bx + cx) / 3;
    const mz = (az + bz + cz) / 3;
    const my = (ay + by + cy) / 3;
    c.copy(grass).lerp(grass2, valueNoise(mx * 0.08, mz * 0.08, map.seed + 5));
    const dn = valueNoise(mx * 0.035 + 7, mz * 0.035, map.seed + 9);
    if (dn > 0.68) c.lerp(dirt, Math.min(1, (dn - 0.68) * 4));
    if (ny < 0.78) c.lerp(rock, Math.min(1, (0.78 - ny) * 4));
    const hw = terrain.riverHalfWidth;
    const rd = terrain.riverDistance(mx, mz);
    if (rd < hw + 2.5) c.lerp(sand, Math.min(1, (hw + 2.5 - rd) / 2.5));
    if (terrain.riverEnabled && my < terrain.waterLevel - 0.05) c.copy(sand).multiplyScalar(0.72);
    const edge = Math.max(Math.abs(mx), Math.abs(mz)) / half;
    if (edge > 0.9 && !terrain.island) c.multiplyScalar(0.92);
    c.multiplyScalar(0.95 + hash2(Math.floor(mx * 7), Math.floor(mz * 7), 3) * 0.1);
    for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], k + v * 3);
    k += 9;
  };

  const mesh = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k), 3));
    g.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, k), 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    m.name = 'terrain';
    m.receiveShadow = true;
    m.castShadow = true;
    return m;
  };
  return { emit, mesh };
}

export function createTerrainMesh(terrain: Terrain): THREE.Mesh {
  const half = terrain.half;
  const seg = terrainSegments(terrain);
  const step = terrain.size / seg;
  const n = seg + 1;
  const hts = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hts[j * n + i] = terrain.height(-half + i * step, -half + j * step);
  const { emit, mesh } = groundTriangles(terrain, seg * seg * 2);

  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const x0 = -half + i * step;
      const z0 = -half + j * step;
      const x1 = x0 + step;
      const z1 = z0 + step;
      const a = hts[j * n + i];
      const b = hts[j * n + i + 1];
      const cc = hts[(j + 1) * n + i];
      const d = hts[(j + 1) * n + i + 1];
      if ((i + j) % 2 === 0) {
        emit(x0, z0, a, x0, z1, cc, x1, z0, b);
        emit(x1, z0, b, x0, z1, cc, x1, z1, d);
      } else {
        emit(x0, z0, a, x1, z1, d, x1, z0, b);
        emit(x0, z0, a, x0, z1, cc, x1, z1, d);
      }
    }
  }
  return mesh();
}

/** Flat ground ring around the playable square, and the bank from the map's edge down to it, so the map never ends in a void. */
export function createSkirt(terrain: Terrain): THREE.Group {
  const half = terrain.half;
  let low = Infinity;
  for (let i = 0; i <= 40; i++) {
    const t = -half + (i / 40) * terrain.size;
    low = Math.min(low, terrain.height(t, -half), terrain.height(t, half), terrain.height(-half, t), terrain.height(half, t));
  }
  const outer = terrain.size * 6;
  const shape = new THREE.Shape([new THREE.Vector2(-outer, -outer), new THREE.Vector2(outer, -outer), new THREE.Vector2(outer, outer), new THREE.Vector2(-outer, outer)]);
  shape.holes.push(new THREE.Path([new THREE.Vector2(-half, -half), new THREE.Vector2(-half, half), new THREE.Vector2(half, half), new THREE.Vector2(half, -half)]));
  const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  const color = new THREE.Color(terrain.map.grassColor).multiplyScalar(0.82);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  mesh.position.y = low - 0.2;
  mesh.receiveShadow = true;
  mesh.name = 'skirt';
  // Without the bank a camera outside the map looks through the gap under the terrain's edge, into the sky.
  // Sampled like the terrain mesh, so the two meet without a seam.
  const seg = terrainSegments(terrain);
  const step = terrain.size / seg;
  const base = low - 0.2;
  const pos: number[] = [];
  const edges: Array<(t: number) => [number, number]> = [(t) => [t, -half], (t) => [t, half], (t) => [-half, t], (t) => [half, t]];
  for (const at of edges) {
    for (let i = 0; i < seg; i++) {
      const [ax, az] = at(-half + i * step);
      const [bx, bz] = at(-half + (i + 1) * step);
      const ay = terrain.height(ax, az);
      const by = terrain.height(bx, bz);
      pos.push(ax, ay, az, ax, base, az, bx, by, bz, bx, by, bz, ax, base, az, bx, base, bz);
    }
  }
  const bankGeo = new THREE.BufferGeometry();
  bankGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bankGeo.computeVertexNormals();
  const bankColor = new THREE.Color(terrain.map.dirtColor).multiplyScalar(0.7);
  const bank = new THREE.Mesh(bankGeo, new THREE.MeshStandardMaterial({ color: bankColor, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
  bank.name = 'skirt-bank';
  bank.receiveShadow = true;
  const skirt = new THREE.Group();
  skirt.add(mesh, bank);
  return skirt;
}

export interface Water {
  mesh: THREE.Mesh;
  update(time: number): void;
}

/** `gpuWater`: the WebGPU renderer's TSL material (it cannot run the GLSL patch below). */
export function createWater(terrain: Terrain, gpuWater?: typeof waterMaterial): Water | null {
  if (!terrain.riverEnabled) return null;
  const half = terrain.half;
  const along = Math.ceil(terrain.size / 2);
  const across = 6;
  const width = (terrain.riverHalfWidth + 2.2) * 2;
  const verts = (across + 1) * (along + 1);
  const pos = new Float32Array(verts * 3);
  let v = 0;
  for (let j = 0; j <= along; j++) {
    const z = -half + (j / along) * terrain.size;
    const cx = terrain.riverX(z);
    for (let i = 0; i <= across; i++) {
      const x = cx - width / 2 + (i / across) * width;
      pos.set([x, terrain.waterLevel, z], v * 3);
      v++;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < across; i++) {
      const a = j * (across + 1) + i;
      const b = a + 1;
      const c = a + across + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const params: THREE.MeshStandardMaterialParameters = { color: terrain.map.waterColor, transparent: true, opacity: 0.8, roughness: 0.2, metalness: 0.1, flatShading: true };
  // Ripples on the GPU: no per-frame vertex loop or buffer upload (flat shading takes its normals
  // from screen-space derivatives, so the facets still catch the light as the surface moves).
  let mat: THREE.Material;
  let time = { value: 0 };
  if (gpuWater) ({ material: mat, time } = gpuWater(params));
  else {
    const std = new THREE.MeshStandardMaterial(params);
    std.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  transformed.y += sin(position.x * 0.9 + uTime * 1.6) * 0.05 + cos(position.z * 0.5 + uTime * 1.1) * 0.06;',
      );
    };
    mat = std;
  }
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'river';
  mesh.receiveShadow = true;
  return {
    mesh,
    update(t) {
      time.value = t;
    },
  };
}

export function createZoneOverlay(terrain: Terrain, side: Side, color: string): THREE.Group {
  const zone = terrain.zoneOf(side);
  const w = zone.x1 - zone.x0;
  const d = zone.z1 - zone.z0;
  const sx = Math.max(2, Math.round(w / 2));
  const sz = Math.max(2, Math.round(d / 2));
  const plane = new THREE.PlaneGeometry(w, d, sx, sz).rotateX(-Math.PI / 2);
  const p = plane.getAttribute('position') as THREE.BufferAttribute;
  const cx = (zone.x0 + zone.x1) / 2;
  const cz = (zone.z0 + zone.z1) / 2;
  // Island: the zone's corners hang past the coast; pull them onto it (the fill and border follow the cliff edge).
  const onLand = (x: number, z: number): [number, number] => (terrain.island ? terrain.clampToLand(x, z, 1) : [x, z]);
  for (let i = 0; i < p.count; i++) {
    const [x, z] = onLand(p.getX(i) + cx, p.getZ(i) + cz);
    p.setXYZ(i, x, Math.max(terrain.height(x, z), terrain.riverEnabled ? terrain.waterLevel : -Infinity) + 0.12, z);
  }
  plane.computeVertexNormals();
  const group = new THREE.Group();
  group.name = `zone-${side}`;
  const fill = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }));
  fill.renderOrder = 1;
  group.add(fill);
  const border: THREE.Vector3[] = [];
  const edge = (x0: number, z0: number, x1: number, z1: number) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2);
    for (let s = 0; s <= steps; s++) {
      const [x, z] = onLand(x0 + ((x1 - x0) * s) / steps, z0 + ((z1 - z0) * s) / steps);
      border.push(new THREE.Vector3(x, terrain.height(x, z) + 0.2, z));
    }
  };
  edge(zone.x0, zone.z0, zone.x1, zone.z0);
  edge(zone.x1, zone.z0, zone.x1, zone.z1);
  edge(zone.x1, zone.z1, zone.x0, zone.z1);
  edge(zone.x0, zone.z1, zone.x0, zone.z0);
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(border), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })));
  return group;
}
