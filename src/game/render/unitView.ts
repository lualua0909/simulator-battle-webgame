// Unit-follow views: the camera rides along with one soldier instead of filming the whole field.
//   first   through the soldier's eyes (its own model is hidden)
//   second  in front of it, looking back at it as it charges at you
//   third   over its shoulder, looking where it goes
// The followed position and heading are smoothed so the soldier's wobble and ragdoll never shake the view;
// when it dies the view hands over to the nearest living comrade.
import * as THREE from 'three';
import type { Side, Terrain } from '../sim/terrain';
import type { BattleSim, SimUnit } from '../sim/world';

// `side` is not a unit view: it films the whole battle from the flank, enemy on the left and the own army on the right.
export type ViewMode = 'overview' | 'side' | 'third' | 'first' | 'second';
export const VIEW_MODES: readonly ViewMode[] = ['overview', 'side', 'third', 'first', 'second'];

/** The camera rides along with one soldier (first / second / third person). */
export function followsUnit(mode: ViewMode): boolean {
  return mode === 'third' || mode === 'first' || mode === 'second';
}

/** Smallest signed difference a − b between two angles. */
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** Soldiers the view can follow: alive, not a wall or a building. */
function followable(u: SimUnit | undefined): boolean {
  return !!u && u.alive && !u.structure;
}

export class UnitView {
  mode: ViewMode = 'overview';
  /** Followed unit id (-1 = none picked yet). */
  id = -1;
  /** Smoothed feet position of the followed unit. */
  readonly anchor = new THREE.Vector3();
  /** Smoothed heading: the unit faces (sin, cos) of it. */
  heading = 0;
  /** Set whenever the followed unit changed; the reader clears it. */
  switched = false;
  private fresh = true;
  private readonly at = new THREE.Vector3();

  /** Follows the current unit (re-picking when it died) and returns it, or null when nobody is left. */
  track(sim: BattleSim, side: Side, alpha: number, dt: number, near: { x: number; z: number }): SimUnit | null {
    let u: SimUnit | null = sim.units[this.id] ?? null;
    if (!u || !followable(u)) {
      const from = u ?? near;
      u = this.nearest(sim, side, from.x, from.z);
      if (!u) return null;
      this.select(u.id);
    }
    const x = u.px + (u.x - u.px) * alpha;
    const y = u.py + (u.y - u.py) * alpha;
    const z = u.pz + (u.z - u.pz) * alpha;
    const want = Math.atan2(u.fx, u.fz);
    if (this.fresh) {
      this.fresh = false;
      this.anchor.set(x, y, z);
      this.heading = want;
    } else {
      this.anchor.lerp(this.at.set(x, y, z), 1 - Math.exp(-dt * 8));
      this.heading += angleDiff(want, this.heading) * (1 - Math.exp(-dt * 3));
    }
    return u;
  }

  /** Follow this unit from now on (the view jumps to it). */
  select(id: number): void {
    if (id === this.id) return;
    this.id = id;
    this.fresh = true;
    this.switched = true;
  }

  /** Next living soldier of `side` after the current one, by id. */
  next(sim: BattleSim, side: Side): void {
    const own = sim.units.filter((u) => followable(u) && u.side === side);
    const pool = own.length > 0 ? own : sim.units.filter(followable);
    if (pool.length === 0) return;
    this.select((pool.find((u) => u.id > this.id) ?? pool[0]).id);
  }

  /** Closest living soldier to (x, z) within `radius`, any side. */
  unitAt(sim: BattleSim, x: number, z: number, radius: number): SimUnit | null {
    let best: SimUnit | null = null;
    let bestD = radius;
    for (const u of sim.units) {
      if (!followable(u)) continue;
      const d = Math.hypot(u.x - x, u.z - z) - u.radius;
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  /** Where the eye sits for the current mode, facing `heading`. */
  eye(u: SimUnit, heading: number, terrain: Terrain | null, out: THREE.Vector3): THREE.Vector3 {
    const h = u.def.height;
    const r = u.def.radius;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const a = this.anchor;
    if (this.mode === 'first') out.set(a.x + fx * r * 0.6, a.y + h * 0.92, a.z + fz * r * 0.6);
    else if (this.mode === 'second') {
      const d = 2.5 + h * 1.2 + r;
      out.set(a.x + fx * d, a.y + h * 0.8 + 0.3, a.z + fz * d);
    } else {
      const d = 2.2 + h * 1.2 + r;
      out.set(a.x - fx * d, a.y + h * 1.1 + 0.8, a.z - fz * d);
    }
    if (terrain) out.y = Math.max(out.y, terrain.height(out.x, out.z) + 0.4);
    return out;
  }

  /** What the eye looks at (desktop; in VR the head aims itself). */
  look(u: SimUnit, heading: number, out: THREE.Vector3): THREE.Vector3 {
    const h = u.def.height;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const a = this.anchor;
    if (this.mode === 'first') return out.set(a.x + fx * 12, a.y + h * 0.75, a.z + fz * 12);
    if (this.mode === 'second') return out.set(a.x, a.y + h * 0.6, a.z);
    return out.set(a.x + fx * 6, a.y + h * 0.6, a.z + fz * 6);
  }

  private nearest(sim: BattleSim, side: Side, x: number, z: number): SimUnit | null {
    let best: SimUnit | null = null;
    let bestD = Infinity;
    for (const pass of [true, false]) {
      for (const u of sim.units) {
        if (!followable(u) || (pass && u.side !== side)) continue;
        const d = Math.hypot(u.x - x, u.z - z);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      if (best) return best;
    }
    return null;
  }
}
