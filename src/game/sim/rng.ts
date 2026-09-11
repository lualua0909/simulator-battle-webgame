// Deterministic numeric helpers for the battle simulation.
//
// Online battles run the same simulation on two machines from the same seed, so every
// value that can influence gameplay must be bit-identical across JS engines. IEEE-754
// + - * / and Math.sqrt are exact everywhere; Math.sin/cos/atan2/exp/pow/hypot are not
// (implementation-defined last ulp). The sim therefore uses only the helpers below.

/** mulberry32 — small, fast, deterministic PRNG. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Uniform point in the unit disk (rejection sampling, no trig). */
  disk(): [number, number] {
    for (;;) {
      const x = this.next() * 2 - 1;
      const z = this.next() * 2 - 1;
      if (x * x + z * z <= 1) return [x, z];
    }
  }
}

/** Integer lattice hash → [0, 1). Inputs must be integers. */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function smooth01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Bilinear value noise in [0, 1). */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth01(x - ix);
  const fz = smooth01(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fz;
}

/** 1D value noise in [0, 1). */
export function valueNoise1(x: number, seed: number): number {
  const ix = Math.floor(x);
  const f = smooth01(x - ix);
  const a = hash2(ix, 0, seed);
  const b = hash2(ix + 1, 0, seed);
  return a + (b - a) * f;
}

const TWO_PI = 6.283185307179586;

/** Deterministic cosine (range-reduced Taylor series, |err| < 5e-6). */
export function dcos(x: number): number {
  const r = x - TWO_PI * Math.round(x / TWO_PI);
  const x2 = r * r;
  // Horner form of 1 - x²/2! + x⁴/4! - ... - x¹⁴/14! + x¹⁶/16!
  return (
    1 +
    x2 *
      (-1 / 2 +
        x2 *
          (1 / 24 +
            x2 *
              (-1 / 720 +
                x2 *
                  (1 / 40320 +
                    x2 *
                      (-1 / 3628800 +
                        x2 * (1 / 479001600 + x2 * (-1 / 87178291200 + x2 * (1 / 20922789888000))))))))
  );
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** FNV-1a over 32-bit integers, for desync checksums. */
export function fnv1a(values: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    let x = v | 0;
    for (let i = 0; i < 4; i++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  }
  return h >>> 0;
}
