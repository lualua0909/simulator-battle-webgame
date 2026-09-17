// Deterministic battlefield: height field, river, deployment zones and obstacles.
// Shared by the simulation (gameplay) and the renderer (visuals) so both agree exactly.
import type { AssetDef, MapDef } from '@/shared/schema';
import { Rng, clamp, smooth01, valueNoise, valueNoise1 } from './rng';

export const EDGE_MARGIN = 6;
/** Siege wall / watchtower grid cell (m). */
export const WALL_CELL = 2;

/** Grid index of a coordinate. */
export function wallIndex(v: number): number {
  return Math.floor(v / WALL_CELL);
}

/** Centre of a grid index. */
export function wallCenter(i: number): number {
  return (i + 0.5) * WALL_CELL;
}

export type Side = 'blue' | 'red' | 'green' | 'yellow';
export const ALL_SIDES: readonly Side[] = ['blue', 'red', 'green', 'yellow'];

export interface Zone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export type ObstacleKind = 'tree' | 'rock' | 'bush';

export interface Obstacle {
  kind: ObstacleKind;
  assetId: string;
  x: number;
  y: number;
  z: number;
  /** Collision radius; 0 = decorative only. */
  radius: number;
  scale: number;
  /** Yaw as a fraction of a full turn (render-only). */
  yaw: number;
  variant: number;
}

export class Terrain {
  readonly size: number;
  readonly half: number;
  readonly activeSides: readonly Side[];
  readonly zones: Partial<Record<Side, Zone>>;
  readonly riverEnabled: boolean;
  readonly riverHalfWidth: number;
  readonly riverBase = 0;
  readonly riverDepth: number;
  readonly waterLevel: number;
  /** Width of the only shallow crossing of a deep river (0 = wadeable everywhere). */
  readonly ford: number;
  readonly obstacles: Obstacle[] = [];

  private readonly seed: number;
  private readonly heightScale: number;
  private readonly freq: number;
  private readonly meander: number;
  private readonly riverLimit: number;

  constructor(
    readonly map: MapDef,
    assets: readonly AssetDef[] = [],
    /** Siege mode: the defending side (its zone uses map.defenseDepth); null = open battle. Siege is 2-side only. */
    readonly defense: Side | null = null,
    /** Sides deploying in this match, in seat order. 2 keeps the classic opposite-strip layout; 3-4 deploy at corners spaced evenly around the centre. */
    activeSides: readonly Side[] = ['blue', 'red'],
  ) {
    this.size = map.size;
    this.half = map.size / 2;
    this.activeSides = activeSides;
    this.seed = map.seed;
    this.heightScale = map.heightScale;
    this.freq = 0.018 * map.hilliness;

    const usable = this.half - EDGE_MARGIN;
    const base = Math.min(map.deployDepth, usable - 8);
    this.zones = {};
    let inner: number;
    if (activeSides.length <= 2) {
      const depthOf = (side: Side) => {
        if (side !== defense || map.defenseDepth <= 0) return base;
        // The defenders' zone may reach past the middle, leaving a 16 m gap to the attackers.
        return Math.min(map.defenseDepth, usable * 2 - base - 16);
      };
      const [a, b] = activeSides;
      const aDepth = depthOf(a);
      const bDepth = depthOf(b);
      this.zones[a] = { x0: -usable, x1: -usable + aDepth, z0: -usable, z1: usable };
      this.zones[b] = { x0: usable - bDepth, x1: usable, z0: -usable, z1: usable };
      inner = Math.min(usable - aDepth, usable - bDepth);
    } else {
      // Corner deployment (open battle only): squares spaced evenly around the map centre,
      // sized off the same deployDepth setting. Positions are hardcoded unit vectors, not
      // Math.cos/sin, to avoid any cross-engine trig rounding drift.
      const size = Math.min(base * 2, usable * 0.45);
      const half2 = size / 2;
      const r = usable - half2 * 1.15;
      const corners: Array<[number, number]> =
        activeSides.length === 3
          ? [
              [r, 0],
              [-r / 2, r * 0.8660254037844387],
              [-r / 2, -r * 0.8660254037844387],
            ]
          : [
              [r, r],
              [-r, r],
              [-r, -r],
              [r, -r],
            ];
      inner = Infinity;
      activeSides.forEach((side, i) => {
        const [cx, cz] = corners[i];
        this.zones[side] = { x0: cx - half2, x1: cx + half2, z0: cz - half2, z1: cz + half2 };
        inner = Math.min(inner, Math.abs(cx) - half2);
      });
    }

    this.riverEnabled = map.river.enabled;
    this.riverHalfWidth = map.river.width / 2;
    this.riverDepth = 1.4 + map.river.width * 0.06;
    this.waterLevel = this.riverBase - 0.35;
    this.meander = map.river.meander;
    this.ford = map.river.enabled ? map.river.ford : 0;
    // Keep the river valley out of both deployment zones.
    this.riverLimit = Math.max(0, inner - this.riverHalfWidth * 3.5 - 2);

    this.scatter(assets);
  }

  riverX(z: number): number {
    if (!this.riverEnabled) return 0;
    const a = (valueNoise1(z * 0.015 + 3.7, this.seed + 101) - 0.5) * 2;
    const b = (valueNoise1(z * 0.04 + 1.3, this.seed + 202) - 0.5) * 0.5;
    return clamp(this.meander * (a + b), -this.riverLimit, this.riverLimit);
  }

  riverDistance(x: number, z: number): number {
    if (!this.riverEnabled) return Infinity;
    const d = x - this.riverX(z);
    return d < 0 ? -d : d;
  }

  /** Deep water ground units cannot enter (rivers with a ford). */
  deepWater(x: number, z: number): boolean {
    return this.ford > 0 && (z < 0 ? -z : z) > this.ford / 2 && this.inWater(x, z);
  }

  inWater(x: number, z: number): boolean {
    return this.riverDistance(x, z) < this.riverHalfWidth;
  }

  private baseHeight(x: number, z: number): number {
    const f = this.freq;
    const n =
      valueNoise(x * f, z * f, this.seed) * 0.55 +
      valueNoise(x * f * 2.1, z * f * 2.1, this.seed + 17) * 0.3 +
      valueNoise(x * f * 4.3, z * f * 4.3, this.seed + 33) * 0.15;
    let h = (n - 0.5) * 2 * this.heightScale;
    if (this.map.rise !== 0) {
      // Ramp over the middle fifth of the map onto a plateau.
      const s = this.map.rise > 0 ? x : -x;
      h += (this.map.rise < 0 ? -this.map.rise : this.map.rise) * smooth01((s + this.size * 0.02) / (this.size * 0.2));
    }
    const ax = x < 0 ? -x : x;
    const az = z < 0 ? -z : z;
    const e = (ax > az ? ax : az) / this.half;
    // Gentle rim of hills framing the battlefield.
    if (e > 0.8) {
      const t = (e - 0.8) / 0.2;
      h += t * t * 7;
    }
    return h;
  }

  height(x: number, z: number): number {
    let h = this.baseHeight(x, z);
    if (this.riverEnabled) {
      const d = this.riverDistance(x, z);
      const hw = this.riverHalfWidth;
      const valley = hw * 3.5;
      if (d < valley) {
        h = this.riverBase + (h - this.riverBase) * smooth01((d - hw) / (valley - hw));
        if (d < hw) {
          const t = d / hw;
          const az = z < 0 ? -z : z;
          // The ford is a shallow riverbed.
          const depth = this.ford > 0 ? (az <= this.ford / 2 ? 0.45 : this.riverDepth * 1.6) : this.riverDepth;
          h = this.riverBase - depth * (1 - t * t);
        }
      }
    }
    return h;
  }

  /** Upper bound of height(): noise peak plus the rim hills (the river only lowers). */
  get maxHeight(): number {
    return this.heightScale + 7 + (this.map.rise < 0 ? -this.map.rise : this.map.rise);
  }

  /** The deployment zone of an active side; throws for a side not in this match. */
  zoneOf(side: Side): Zone {
    const zone = this.zones[side];
    if (!zone) throw new Error(`Không có vùng triển khai cho phe ${side}`);
    return zone;
  }

  inZone(side: Side, x: number, z: number): boolean {
    const zone = this.zones[side];
    return !!zone && x >= zone.x0 && x <= zone.x1 && z >= zone.z0 && z <= zone.z1;
  }

  private scatter(assets: readonly AssetDef[]): void {
    const byId = new Map(assets.map((a) => [a.id, a]));
    const rng = new Rng(Math.imul(this.seed, 7919) + 13);
    const hectares = (this.size * this.size) / 10000;
    const solid: Obstacle[] = [];

    const place = (kind: ObstacleKind, perHectare: number, kinds: readonly string[]) => {
      const usable = kinds.filter((id) => byId.get(id)?.kind === kind);
      if (usable.length === 0 || perHectare <= 0) return;
      const target = Math.round(perHectare * hectares);
      let placed = 0;
      for (let attempt = 0; attempt < target * 6 && placed < target; attempt++) {
        const x = rng.range(-this.half + 2, this.half - 2);
        const z = rng.range(-this.half + 2, this.half - 2);
        const roll = rng.next();
        const assetId = usable[rng.int(usable.length)];
        const variant = rng.int(3);
        const yaw = rng.next();
        const jitter = rng.next();
        if (this.activeSides.some((s) => this.inZone(s, x, z)) && roll > 0.12) continue;
        if (this.riverDistance(x, z) < this.riverHalfWidth + 1.5) continue;
        const asset = byId.get(assetId)!;
        const scale =
          asset.scale * (kind === 'tree' ? 0.8 + jitter * 0.45 : kind === 'rock' ? 0.5 + jitter * 1.1 : 0.7 + jitter * 0.5);
        const radius = kind === 'tree' ? 0.35 * scale : kind === 'rock' ? 0.9 * scale : 0;
        if (radius > 0) {
          let blocked = false;
          for (const o of solid) {
            const dx = o.x - x;
            const dz = o.z - z;
            const min = o.radius + radius + 2;
            if (dx * dx + dz * dz < min * min) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;
        }
        const obstacle: Obstacle = { kind, assetId, x, y: this.height(x, z), z, radius, scale, yaw, variant };
        this.obstacles.push(obstacle);
        if (radius > 0) solid.push(obstacle);
        placed++;
      }
    };

    place('rock', this.map.rocks.perHectare, this.map.rocks.kinds);
    place('tree', this.map.trees.perHectare, this.map.trees.kinds);
    place('bush', this.map.bushes.perHectare, this.map.bushes.kinds);
  }
}
