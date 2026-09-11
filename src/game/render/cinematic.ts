// Scripted camera flights: Catmull-Rom through timed shots (camera position + look-at),
// eased at both ends so the hand-off to the RTS camera has no jolt.
import * as THREE from 'three';
import type { Terrain } from '../sim/terrain';

export interface Shot {
  /** Seconds from the start; the last shot's time is the flight's duration. */
  at: number;
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

export class Cinematic {
  readonly duration: number;
  private time = 0;
  private readonly pos: THREE.CatmullRomCurve3;
  private readonly look: THREE.CatmullRomCurve3;
  private readonly p = new THREE.Vector3();
  private readonly l = new THREE.Vector3();

  constructor(
    private readonly shots: readonly Shot[],
    private readonly terrain: Terrain | null,
  ) {
    this.duration = shots[shots.length - 1].at;
    this.pos = new THREE.CatmullRomCurve3(shots.map((s) => s.pos), false, 'centripetal');
    this.look = new THREE.CatmullRomCurve3(shots.map((s) => s.look), false, 'centripetal');
  }

  /** Advances and poses the camera; returns false once the flight is over. */
  update(dt: number, camera: THREE.Camera): boolean {
    this.time = Math.min(this.duration, this.time + dt);
    const x = this.time / this.duration;
    const eased = x * x * (3 - 2 * x) * this.duration;
    const s = this.shots;
    let i = 0;
    while (i < s.length - 2 && eased > s[i + 1].at) i++;
    const u = (i + (eased - s[i].at) / Math.max(1e-6, s[i + 1].at - s[i].at)) / (s.length - 1);
    this.pos.getPoint(u, this.p);
    this.look.getPoint(u, this.l);
    if (this.terrain) this.p.y = Math.max(this.p.y, this.terrain.height(this.p.x, this.p.z) + 1.5);
    camera.position.copy(this.p);
    camera.lookAt(this.l);
    return this.time < this.duration;
  }
}
