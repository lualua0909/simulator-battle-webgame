// Wall stacks drawn as instanced stone blocks with a merlon crown on the top block,
// cracks spreading over the top block as it loses HP, a shudder when hit, and a rubble
// heap where a cell collapsed. Crumbling chunks come from DebrisSystem (engine events).
import * as THREE from 'three';
import { parseAssetParams, type ConfigBundle, type StructureParams } from '@/shared/schema';
import { wallBlockGeometry, wallCrackGeometry, wallCrownGeometry, wallRubbleGeometry } from '../models/structures';
import type { Side } from '../sim/terrain';
import type { BattleSim, WallCell } from '../sim/world';

const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
const crackMaterial = new THREE.MeshBasicMaterial({ color: '#1b1612', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
const VARIANTS = 3;

interface Look {
  params: StructureParams;
  blocks: THREE.InstancedMesh[];
  crowns: THREE.InstancedMesh;
  rubble: THREE.InstancedMesh;
  cracks: THREE.InstancedMesh;
  /** A real uploaded mesh already has its own coping/top edge — the procedural WALL_CELL-square crown and crack decals were sized for the old cube and would float mismatched over it. */
  hasGlb: boolean;
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
    this.clear();
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
      const inst = (geo: THREE.BufferGeometry, count: number, mat: THREE.Material = material) => {
        const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
        mesh.count = 0;
        mesh.castShadow = mat === material;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        return mesh;
      };
      const blocks = Array.from({ length: VARIANTS }, (_, v) => {
        const mesh = inst(wallBlockGeometry(params, tierHeight, (asset?.seed ?? 1) * 10 + v, asset?.glb?.url), n.blocks);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n.blocks) * 3).fill(1), 3);
        return mesh;
      });
      this.looks.set(modelId, {
        params,
        blocks,
        crowns: inst(wallCrownGeometry(params, 3), n.cells),
        rubble: inst(wallRubbleGeometry(params, 5), n.cells),
        cracks: inst(wallCrackGeometry(tierHeight, 7), n.cells, crackMaterial),
        hasGlb: Boolean(asset?.glb),
      });
    }
  }

  onHit(unitId: number, damage: number): void {
    if (damage > 0) this.shudder.set(unitId, Math.min(0.35, (this.shudder.get(unitId) ?? 0) + 0.08 + damage * 0.0006));
  }

  update(dt: number, hidden: Side | null): void {
    if (this.cells.length === 0) return;
    const tierHeight = this.bundle.settings.siege.tierHeight;
    const used = new Map<Look, { blocks: number[]; crowns: number; rubble: number; cracks: number }>();
    for (const look of this.looks.values()) used.set(look, { blocks: Array(VARIANTS).fill(0), crowns: 0, rubble: 0, cracks: 0 });
    for (const cell of this.cells) {
      const u = cell.unit;
      const look = this.looks.get(u.def.modelId);
      if (!look || (hidden && u.side === hidden)) continue;
      const n = used.get(look)!;
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
      for (let t = -1; t < cell.tiers; t++) {
        const top = t === cell.tiers - 1;
        const v = (((cell.ix * 3 + cell.iz * 5 + t) % VARIANTS) + VARIANTS) % VARIANTS;
        const turn = this.orient.get(u.id) ?? 0;
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, turn);
        const k = top ? jx : jx * 0.4;
        this.m.compose(this.p.set(x + k, u.y + t * tierHeight, z + (top ? jz : jz * 0.4)), this.q, this.s.set(1, 1, 1));
        const slot = n.blocks[v]++;
        look.blocks[v].setMatrixAt(slot, this.m);
        const wear = top ? Math.max(0, Math.min(1, topHp)) : t < 0 ? 0.85 : 1;
        look.blocks[v].setColorAt(slot, this.c.setScalar(0.62 + 0.38 * wear));
        if (!look.hasGlb && top && wear < 0.7) {
          const grow = 0.55 + (0.7 - wear) * 0.65;
          this.m.compose(this.p.set(x + jx, u.y + t * tierHeight, z + jz), this.q, this.s.set(1, grow, 1));
          look.cracks.setMatrixAt(n.cracks++, this.m);
        }
      }
      if (!look.hasGlb) {
        this.q.identity();
        this.m.compose(this.p.set(x + jx, u.y + cell.tiers * tierHeight, z + jz), this.q, this.s.set(1, 1, 1));
        look.crowns.setMatrixAt(n.crowns++, this.m);
      }
    }
    for (const [look, n] of used) {
      look.blocks.forEach((b, v) => {
        b.count = n.blocks[v];
        b.instanceMatrix.needsUpdate = true;
        if (b.instanceColor) b.instanceColor.needsUpdate = true;
      });
      for (const [mesh, count] of [
        [look.crowns, n.crowns],
        [look.rubble, n.rubble],
        [look.cracks, n.cracks],
      ] as const) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  clear(): void {
    for (const look of this.looks.values()) {
      for (const mesh of [...look.blocks, look.crowns, look.rubble, look.cracks]) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        mesh.dispose();
      }
    }
    this.looks.clear();
    this.cells = [];
    this.shudder.clear();
  }
}
