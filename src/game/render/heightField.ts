// Terrain heights sampled once on a grid for render-side queries (cursor picking runs hundreds
// of height lookups per pointer move). Bilinear between samples; the simulation keeps using
// the exact Terrain.height(), so nothing here can affect online determinism.
import type { Terrain } from '../sim/terrain';

export class HeightField {
  private readonly n: number;
  private readonly h: Float32Array;

  constructor(
    private readonly terrain: Terrain,
    private readonly step = 1,
  ) {
    const n = (this.n = Math.ceil(terrain.size / step) + 1);
    this.h = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.h[j * n + i] = terrain.height(-terrain.half + i * step, -terrain.half + j * step);
  }

  at(x: number, z: number): number {
    const n = this.n;
    const fx = (x + this.terrain.half) / this.step;
    const fz = (z + this.terrain.half) / this.step;
    // Off the grid (outside the map): exact.
    if (!(fx >= 0 && fz >= 0 && fx <= n - 1 && fz <= n - 1)) return this.terrain.height(x, z);
    const i = Math.min(n - 2, Math.floor(fx));
    const j = Math.min(n - 2, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const a = j * n + i;
    const h = this.h;
    const near = h[a] + (h[a + 1] - h[a]) * tx;
    const far = h[a + n] + (h[a + n + 1] - h[a + n]) * tx;
    return near + (far - near) * tz;
  }
}
