// Procedural effect models (img2threejs contract, see common.ts): built in code, seeded,
// named parts the effect renderer animates.
import * as THREE from 'three';
import { ball, detail, faceColors, jitter, mesh, modelRoot, part, Rng, shade, socket } from './common';

export interface TornadoParams {
  /** Radius of the area it sweeps (m): the ground contact is ~half of it, the top flares to ~1.8×. */
  radius: number;
  height: number;
  color: string;
  seed: number;
}

export const TORNADO_BANDS = 7;

/**
 * Whirlwind funnel: stacked open, jittered bands (`band0` at the ground … `band6` at the top)
 * that the renderer spins at different rates, plus a `debris` ring of rocks and clods.
 * Sockets: `base` (dust emitter), `top`.
 */
export function createTornadoModel(p: TornadoParams): THREE.Group {
  const root = modelRoot('tornado', 'static');
  const rng = new Rng(p.seed);
  const bandH = p.height / TORNADO_BANDS;
  for (let i = 0; i < TORNADO_BANDS; i++) {
    const t0 = i / TORNADO_BANDS;
    const t1 = (i + 1) / TORNADO_BANDS;
    const r0 = p.radius * (0.42 + 1.4 * t0 * t0);
    const r1 = p.radius * (0.42 + 1.4 * t1 * t1);
    const band = part(`band${i}`, [0, t0 * p.height, 0]);
    // Overlapping, slightly sheared shells read as one twisting column.
    const shell = new THREE.CylinderGeometry(r1 * 1.05, r0, bandH * 1.45, 11, 2, true).translate(0, bandH * 0.55, 0);
    const dark = shade(p.color, 0.62 + 0.25 * t0);
    const light = shade(p.color, 1.08 + 0.12 * t0);
    band.add(mesh(`funnel-band-${i}`, faceColors(jitter(shell, r0 * 0.22, p.seed + i * 13), dark, light, p.seed + i, 1), p.color, [0, 0, 0], [0.04 * (i % 2 ? 1 : -1), i * 0.9, 0]));
    // Wind streaks wrapping the shell.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + rng.range(0, 1.2);
      const r = (r0 + r1) * 0.55;
      const streak = new THREE.BoxGeometry(r * 0.7, bandH * 0.08, 0.03);
      band.add(detail(mesh(`funnel-streak-${i}-${k}`, streak, shade(p.color, 1.3), [Math.cos(a) * r, bandH * rng.range(0.2, 0.9), Math.sin(a) * r], [0, -a + Math.PI / 2, rng.range(-0.35, 0.35)])));
    }
    root.add(band);
  }
  const debris = part('debris', [0, 0, 0]);
  for (let d = 0; d < 12; d++) {
    const a = (d / 12) * Math.PI * 2 + rng.range(0, 0.4);
    const h = rng.range(0.4, p.height * 0.75);
    const r = p.radius * (0.55 + 1.2 * (h / p.height) ** 2) + rng.range(0.1, 0.5);
    const color = d % 3 === 0 ? '#5f7a3a' : shade('#7a6450', rng.range(0.8, 1.15));
    debris.add(detail(mesh(`debris-${d}`, jitter(ball(rng.range(0.08, 0.2), 0), 0.06, p.seed + 40 + d), color, [Math.cos(a) * r, h, Math.sin(a) * r])));
  }
  root.add(debris);
  root.add(socket('base', [0, 0.2, 0]), socket('top', [0, p.height, 0]));
  return root;
}
