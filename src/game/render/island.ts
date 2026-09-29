// Raised land (TABS style): the floating island (faceted grassy disc) and the square plateau both stand
// on rocky cliffs in a round slab of sea that floats in the sky, with a few rocks in the water and clouds
// drifting around. Render only: the simulation just sees Terrain.height() (islandFloor past the edge).
import * as THREE from 'three';
import { Rng, hash2 } from '../sim/rng';
import type { Terrain } from '../sim/terrain';
import { createTerrainMesh, groundTriangles, terrainSegments } from './terrainMesh';

const SEGMENTS = 120;
const ROCK = new THREE.Color('#aaa59c');
const ROCK_DARK = new THREE.Color('#8b867e');

/** Emits a triangle facing `ref` (swaps the winding when needed). */
type Emit = (ax: number, az: number, ay: number, bx: number, bz: number, by: number, cx: number, cz: number, cy: number) => void;
function facing(emit: Emit, ref: (mx: number, mz: number) => [number, number, number]) {
  return (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
    const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const [rx, ry, rz] = ref((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3);
    if (nx * rx + ny * ry + nz * rz >= 0) emit(a.x, a.z, a.y, b.x, b.z, b.y, c.x, c.z, c.y);
    else emit(a.x, a.z, a.y, c.x, c.z, c.y, b.x, b.z, b.y);
  };
}

/** A point on the land's edge: its top `p` and the outward unit direction (nx, nz). */
interface EdgePoint {
  p: THREE.Vector3;
  nx: number;
  nz: number;
}

/** Cliffs round a closed edge loop: a grass lip overhanging the edge, then layered rock down into the sea. */
function createCliffs(terrain: Terrain, edge: readonly EdgePoint[], taper: number): THREE.Mesh {
  const map = terrain.map;
  const waterY = terrain.islandFloor + 0.4;
  const bottomY = terrain.islandFloor - 3.5;
  const grass = new THREE.Color(map.grassColor).multiplyScalar(0.85);
  const layers = ({ p, nx, nz }: EdgePoint, j: number): THREE.Vector3[] => {
    const at = (out: number, y: number) => new THREE.Vector3(p.x + nx * out, y, p.z + nz * out);
    const pts = [p, at(0.45, p.y - 0.35), at(-0.1, p.y - 1.1)];
    const steps = 5;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const jitter = (hash2(j, s, map.seed + 31) - 0.5) * 1.3;
      pts.push(at(-taper * t + jitter, p.y - 1.1 + (bottomY - p.y + 1.1) * t));
    }
    return pts;
  };
  const walls = edge.map(layers);
  const levels = walls[0].length;
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  /** The lip (the overhang's top and underside bands) is grass; the rest rock. */
  let lip = false;
  const cliffEmit: Emit = (ax, az, ay, bx, bz, by, cx, cz, cy) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    const my = (ay + by + cy) / 3;
    if (lip) c.copy(grass);
    else {
      c.copy(ROCK).lerp(ROCK_DARK, hash2(Math.floor((ax + bx) * 3), Math.floor(my * 2), map.seed + 7));
      // Moss creeping down the upper rock; darker below the water line.
      if (my > waterY + 3) c.lerp(grass, 0.12);
      if (my < waterY) c.multiplyScalar(0.8);
    }
    for (let v = 0; v < 3; v++) col.push(c.r, c.g, c.b);
  };
  const outward = facing(cliffEmit, (mx, mz) => [mx, 0, mz]);
  for (let j = 0; j < edge.length; j++) {
    const a = walls[j];
    const b = walls[(j + 1) % edge.length];
    for (let l = 0; l < levels - 1; l++) {
      lip = l <= 1;
      outward(a[l], a[l + 1], b[l + 1]);
      outward(a[l], b[l + 1], b[l]);
    }
  }
  const cliffGeo = new THREE.BufferGeometry();
  cliffGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cliffGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  cliffGeo.computeVertexNormals();
  const cliffs = new THREE.Mesh(cliffGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  cliffs.name = 'island-cliffs';
  cliffs.castShadow = true;
  cliffs.receiveShadow = true;
  return cliffs;
}

/**
 * A mist sheet below the land (radius well past `seaR`) and clouds around and below.
 */
function addSea(group: THREE.Group, terrain: Terrain, seaR: number): void {
  const map = terrain.map;
  const waterY = terrain.islandFloor + 0.4;
  // A sheet of mist (the sky's horizon colour, unlit) instead of a blue sea: the land's edge fades into fog.
  const mist = new THREE.Mesh(
    new THREE.CircleGeometry(seaR * 6, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: map.skyBottom }),
  );
  mist.position.y = waterY;
  mist.name = 'island-mist';
  group.add(mist);
  const bedY = waterY - 4.5;
  const rng = new Rng(map.seed * 131 + 7);

  // ---- clouds floating around and below the land
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.25 });
  const puff = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 10; i++) {
    const cloud = new THREE.Group();
    const n = 3 + rng.int(3);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Mesh(puff, cloudMat);
      const s = rng.range(1.6, 3.2);
      p.scale.set(s * 1.3, s * 0.8, s);
      p.position.set((k - n / 2) * 2.2 + rng.range(-0.6, 0.6), rng.range(-0.5, 0.8), rng.range(-1, 1));
      cloud.add(p);
    }
    const a = (i / 10) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = seaR * rng.range(1.25, 1.9);
    cloud.position.set(Math.cos(a) * r, rng.range(bedY - 14, 4), Math.sin(a) * r);
    cloud.rotation.y = -a + Math.PI / 2;
    cloud.name = 'cloud';
    group.add(cloud);
  }
}

export function createIsland(terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island';
  const dirs = Array.from({ length: SEGMENTS }, (_, j) => {
    const a = (j / SEGMENTS) * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    return { x, z, coast: terrain.coastRadius(x, z) };
  });

  // ---- grassy top: polar grid from the centre to the coast
  const rings = Math.ceil(terrain.islandRadius / 0.9);
  const top = groundTriangles(terrain, SEGMENTS * (rings * 2 - 1));
  const up = facing(top.emit, () => [0, 1, 0]);
  const ring = (i: number) =>
    dirs.map((d) => {
      const r = d.coast * (i / rings) * 0.999;
      return new THREE.Vector3(d.x * r, terrain.height(d.x * r, d.z * r), d.z * r);
    });
  let inner = ring(0);
  for (let i = 1; i <= rings; i++) {
    const outer = ring(i);
    for (let j = 0; j < SEGMENTS; j++) {
      const k = (j + 1) % SEGMENTS;
      if (i === 1) up(inner[0], outer[j], outer[k]);
      else {
        up(inner[j], outer[j], outer[k]);
        up(inner[j], outer[k], inner[k]);
      }
    }
    inner = outer;
  }
  group.add(top.mesh());

  const coast = inner;
  group.add(createCliffs(terrain, dirs.map((d, j) => ({ p: coast[j], nx: d.x, nz: d.z })), terrain.islandRadius * 0.05));
  addSea(group, terrain, terrain.islandRadius * 1.45);
  return group;
}

/** Square map raised like the island: the faceted field on cliffs, sampled like the terrain mesh so they meet without a seam. */
export function createPlateau(terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  group.name = 'plateau';
  group.add(createTerrainMesh(terrain));
  const half = terrain.half;
  const seg = terrainSegments(terrain);
  const step = terrain.size / seg;
  const edge: EdgePoint[] = [];
  const s = Math.SQRT1_2;
  // Counter-clockwise from the (-half, -half) corner; corners push out diagonally.
  const sides: Array<[(t: number) => [number, number], number, number, number, number]> = [
    [(t) => [t, -half], 0, -1, -s, -s],
    [(t) => [half, t], 1, 0, s, -s],
    [(t) => [-t, half], 0, 1, s, s],
    [(t) => [-half, -t], -1, 0, -s, s],
  ];
  for (const [at, nx, nz, cx, cz] of sides) {
    for (let i = 0; i < seg; i++) {
      const [x, z] = at(-half + i * step);
      edge.push({ p: new THREE.Vector3(x, terrain.height(x, z), z), nx: i === 0 ? cx : nx, nz: i === 0 ? cz : nz });
    }
  }
  group.add(createCliffs(terrain, edge, half * 0.05));
  // Rocks start past the square's edge that way; the sea's rim clears its corners.
  addSea(group, terrain, half * Math.SQRT2 * 1.3);
  return group;
}
