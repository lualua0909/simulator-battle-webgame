// Wall stacks drawn as instanced rectangular blocks (Three.js Box, no glb) with a merlon
// crown on the top block, cracks spreading over the top block as it loses HP, a shudder
// when hit, and a rubble heap where a cell collapsed. Crumbling chunks come from DebrisSystem.
import * as THREE from 'three';
import { parseAssetParams, type ConfigBundle, type StructureParams } from '@/shared/schema';
import { wallBlockGeometry, wallCrackGeometry, wallCrownGeometry, wallRubbleGeometry } from '../models/structures';
import type { Side } from '../sim/terrain';
import type { BattleSim, WallCell } from '../sim/world';
import { commitInstances } from './instancing';

const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
const crackMaterial = new THREE.MeshBasicMaterial({ color: '#1b1612', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
const VARIANTS = 3;

interface Look {
  params: StructureParams;
  /** Chiều cao 1 khối của mẫu tường này (asset wallHeight, fallback siege.tierHeight). */
  blockH: number;
  blocks: THREE.InstancedMesh[];
  crowns: THREE.InstancedMesh;
  rubble: THREE.InstancedMesh;
  cracks: THREE.InstancedMesh;
  /** Instances written this frame. */
  used: { blocks: number[]; crowns: number; rubble: number; cracks: number };
}

/** Chiều cao 1 khối tường: ưu tiên asset params (CMS), fallback siege.tierHeight. */
export function wallBlockHeight(params: StructureParams, tierHeight: number): number {
  const h = Number(params.wallHeight);
  return Number.isFinite(h) && h >= 0.5 && h <= 4 ? h : tierHeight;
}

export class WallRenderer {
  readonly group = new THREE.Group();
  private looks = new Map<string, Look>();
  private cells: WallCell[] = [];
  private readonly shudder = new Map<number, number>();
  /** Yaw (0 or 90°) so an elongated wall-run mesh lines up with its neighbours instead of the old random per-tier spin. */
  private readonly orient = new Map<number, number>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  /** Generated wall geometry per model, reused across builds (deployment rebuilds on every placement). */
  private readonly geometry = new Map<string, { blocks: THREE.BufferGeometry[]; crown: THREE.BufferGeometry; rubble: THREE.BufferGeometry; crack: THREE.BufferGeometry }>();

  constructor(private readonly bundle: ConfigBundle) {
    this.group.name = 'walls';
  }

  /** Stone colours of a wall unit's model (debris uses them). */
  colors(cell: WallCell): string[] {
    const look = this.looks.get(cell.unit.def.modelId);
    const p = look?.params ?? parseAssetParams('structure', {});
    return [p.stone, p.stone2];
  }

  build(sim: BattleSim): void {
    this.release();
    const tierHeight = this.bundle.settings.siege.tierHeight;
    this.cells = [...sim.walls.values()].filter((c) => c.kind === 'wall');
    this.orient.clear();
    const present = new Set(this.cells.map((c) => `${c.ix},${c.iz}`));
    for (const c of this.cells) {
      const alongX = present.has(`${c.ix + 1},${c.iz}`) || present.has(`${c.ix - 1},${c.iz}`);
      this.orient.set(c.unit.id, alongX ? 0 : Math.PI / 2);
    }
    const counts = new Map<string, { blocks: number; cells: number }>();
    for (const c of this.cells) {
      const n = counts.get(c.unit.def.modelId) ?? { blocks: 0, cells: 0 };
      // +1: a buried footing block so walls on slopes never float.
      n.blocks += c.tiers + 1;
      n.cells++;
      counts.set(c.unit.def.modelId, n);
    }
    for (const [modelId, n] of counts) {
      const asset = this.bundle.assets.find((a) => a.id === modelId);
      const params = parseAssetParams('structure', asset?.params ?? {});
      const blockH = wallBlockHeight(params, tierHeight);
      let geo = this.geometry.get(modelId);
      if (!geo) {
        const seed = (asset?.seed ?? 1) * 10;
        geo = {
          blocks: Array.from({ length: VARIANTS }, (_, v) => wallBlockGeometry(params, blockH, seed + v)),
          crown: wallCrownGeometry(params, 3),
          rubble: wallRubbleGeometry(params, 5),
          crack: wallCrackGeometry(params, blockH, 7),
        };
        this.geometry.set(modelId, geo);
      }
      const inst = (g: THREE.BufferGeometry, count: number, mat: THREE.Material = material) => {
        const mesh = new THREE.InstancedMesh(g, mat, Math.max(1, count));
        mesh.count = 0;
        mesh.castShadow = mat === material;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        return mesh;
      };
      const blocks = geo.blocks.map((g) => {
        const mesh = inst(g, n.blocks);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n.blocks) * 3).fill(1), 3);
        return mesh;
      });
      this.looks.set(modelId, {
        params,
        blockH,
        blocks,
        crowns: inst(geo.crown, n.cells),
        rubble: inst(geo.rubble, n.cells),
        cracks: inst(geo.crack, n.cells, crackMaterial),
        used: { blocks: geo.blocks.map(() => 0), crowns: 0, rubble: 0, cracks: 0 },
      });
    }
  }

  onHit(unitId: number, damage: number): void {
    if (damage > 0) this.shudder.set(unitId, Math.min(0.35, (this.shudder.get(unitId) ?? 0) + 0.08 + damage * 0.0006));
  }

  update(dt: number, hidden: Side | null): void {
    if (this.cells.length === 0) return;
    for (const look of this.looks.values()) {
      const u = look.used;
      u.blocks.fill(0);
      u.crowns = u.rubble = u.cracks = 0;
    }
    for (const cell of this.cells) {
      const u = cell.unit;
      const look = this.looks.get(u.def.modelId);
      if (!look || (hidden && u.side === hidden)) continue;
      const blockH = look.blockH;
      const n = look.used;
      const x = u.x;
      const z = u.z;
      if (!u.alive) {
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (cell.ix * 7 + cell.iz * 13) % 6);
        this.m.compose(this.p.set(x, u.y, z), this.q, this.s.set(1, 1, 1));
        look.rubble.setMatrixAt(n.rubble++, this.m);
        continue;
      }
      let jx = 0;
      let jz = 0;
      const sh = this.shudder.get(u.id) ?? 0;
      if (sh > 0) {
        jx = (Math.random() * 2 - 1) * sh * 0.12;
        jz = (Math.random() * 2 - 1) * sh * 0.12;
        const next = sh - dt * 1.5;
        if (next <= 0) this.shudder.delete(u.id);
        else this.shudder.set(u.id, next);
      }
      // HP left in the top block: the top block darkens and cracks as it wears down.
      const topHp = (u.hp - (cell.tiers - 1) * cell.blockHp) / cell.blockHp;
      const turn = this.orient.get(u.id) ?? 0;
      for (let t = -1; t < cell.tiers; t++) {
        const top = t === cell.tiers - 1;
        const v = (((cell.ix * 3 + cell.iz * 5 + t) % VARIANTS) + VARIANTS) % VARIANTS;
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, turn);
        const k = top ? jx : jx * 0.4;
        this.m.compose(this.p.set(x + k, u.y + t * blockH, z + (top ? jz : jz * 0.4)), this.q, this.s.set(1, 1, 1));
        const slot = n.blocks[v]++;
        look.blocks[v].setMatrixAt(slot, this.m);
        const wear = top ? Math.max(0, Math.min(1, topHp)) : t < 0 ? 0.85 : 1;
        look.blocks[v].setColorAt(slot, this.c.setScalar(0.62 + 0.38 * wear));
        if (top && wear < 0.7) {
          const grow = 0.55 + (0.7 - wear) * 0.65;
          this.m.compose(this.p.set(x + jx, u.y + t * blockH, z + jz), this.q, this.s.set(1, grow, 1));
          look.cracks.setMatrixAt(n.cracks++, this.m);
        }
      }
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, turn);
      this.m.compose(this.p.set(x + jx, u.y + cell.tiers * blockH, z + jz), this.q, this.s.set(1, 1, 1));
      look.crowns.setMatrixAt(n.crowns++, this.m);
    }
    for (const look of this.looks.values()) {
      const n = look.used;
      look.blocks.forEach((b, v) => commitInstances(b, n.blocks[v]));
      commitInstances(look.crowns, n.crowns);
      commitInstances(look.rubble, n.rubble);
      commitInstances(look.cracks, n.cracks);
    }
  }

  /** Drops the instanced meshes of the last build (the geometry cache stays). */
  private release(): void {
    for (const look of this.looks.values()) {
      for (const mesh of [...look.blocks, look.crowns, look.rubble, look.cracks]) {
        this.group.remove(mesh);
        mesh.dispose();
      }
    }
    this.looks.clear();
    this.cells = [];
    this.shudder.clear();
  }

  clear(): void {
    this.release();
    for (const g of this.geometry.values()) for (const geo of [...g.blocks, g.crown, g.rubble, g.crack]) geo.dispose();
    this.geometry.clear();
  }
}
