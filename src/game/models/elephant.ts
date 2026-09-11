// Low-poly elephant / mammoth (quadruped rig): segmented trunk, flappable ears,
// tapered-sweep tusks, optional howdah with a rider socket.
import type * as THREE from 'three';
import type { ElephantParams } from '@/shared/schema';
import { ball, beam, box, cone, cyl, detail, ell, faceColors, jitter, mesh, modelRoot, part, shade, socket, sweep } from './common';

export function createElephantModel(p: ElephantParams, seed = 1): THREE.Group {
  const root = modelRoot(p.fur ? 'mammoth' : 'elephant', 'quadruped');
  const dark = shade(p.skin, 0.72);
  const skin = (geo: THREE.BufferGeometry, s: number) => (p.fur ? faceColors(jitter(geo, 0.1, seed + s), p.skin, dark, seed + s) : geo);

  const body = part('body', [0, 2.05, 0]);
  root.add(body);
  body.add(mesh('body', skin(ell(0.95, 1.0, 1.4), 1), p.skin));
  if (p.fur) {
    body.add(mesh('fur-skirt', faceColors(jitter(ell(1.02, 0.5, 1.36), 0.16, seed + 2), dark, shade(p.skin, 0.55), seed + 2), dark, [0, -0.55, 0]));
  }

  const head = part('head', [0, 0.4, 1.3]);
  body.add(head);
  head.add(mesh('head', skin(ell(0.7, 0.72, 0.66), 3), p.skin, [0, 0.1, 0.25]));
  if (p.fur) head.add(mesh('hump', faceColors(jitter(ell(0.55, 0.5, 0.55), 0.12, seed + 4), p.skin, dark, seed + 4), p.skin, [0, 0.6, -0.05]));
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'L' : 'R';
    head.add(detail(mesh(`eye-${side}`, ball(0.055, 0), '#141414', [0.42 * s, 0.2, 0.62])));
    const ear = part(`ear${side}`, [0.55 * s, 0.15, 0.1]);
    const earSize = p.fur ? 0.55 : 1;
    ear.add(mesh(`ear-${side}`, ell(0.07, 0.62 * earSize, 0.55 * earSize), shade(p.skin, 0.9), [0.1 * s, -0.12, -0.28 * earSize], [0, 0.35 * s, 0]));
    head.add(ear);
  }

  // trunk: three chained pivots so it can curl
  const trunk1 = part('trunk1', [0, -0.25, 0.8]);
  trunk1.add(mesh('trunk-1', sweep([[0, 0.15, -0.1], [0, -0.3, 0.15], [0, -0.6, 0.2]], [0.3, 0.24, 0.2]), p.skin));
  const trunk2 = part('trunk2', [0, -0.6, 0.2]);
  trunk2.add(mesh('trunk-2', sweep([[0, 0.05, 0], [0, -0.35, 0.05], [0, -0.6, 0.12]], [0.2, 0.16, 0.13]), p.skin));
  const trunk3 = part('trunk3', [0, -0.6, 0.12]);
  trunk3.add(mesh('trunk-3', sweep([[0, 0.05, 0], [0, -0.3, 0.12], [0, -0.38, 0.3]], [0.13, 0.1, 0.08]), shade(p.skin, 0.95)));
  trunk2.add(trunk3);
  trunk1.add(trunk2);
  head.add(trunk1);

  if (p.tusks) {
    const k = p.fur ? 1.45 : 1;
    for (const s of [1, -1]) {
      const pts: [number, number, number][] = [
        [0.3 * s, -0.42, 0.55],
        [0.36 * s * k, -0.8 * k, 0.85],
        [0.34 * s * k, -0.78 * k, 1.25 * k],
        [0.18 * s * k, -0.42 * k, 1.5 * k],
      ];
      head.add(mesh(`tusk-${s > 0 ? 'L' : 'R'}`, sweep(pts, [0.085, 0.075, 0.05, 0.005], 6), p.tuskColor));
    }
  }

  for (const [key, z] of [['F', 0.85], ['B', -0.85]] as const) {
    for (const s of [1, -1] as const) {
      const side = s > 0 ? 'L' : 'R';
      const leg = part(`leg${key}${side}`, [0.58 * s, -0.55, z]);
      leg.add(mesh(`thigh-${key}${side}`, skin(beam([0, 0.25, 0], [0, -0.75, 0], 0.37, 0.3, 7), 10), p.skin));
      const shin = part(`shin${key}${side}`, [0, -0.75, 0]);
      shin.add(mesh(`shin-${key}${side}`, skin(beam([0, 0.02, 0], [0, -0.66, 0], 0.3, 0.32, 7), 20), p.skin));
      shin.add(mesh(`foot-${key}${side}`, cyl(0.34, 0.36, 0.1, 8), shade(p.skin, 0.8), [0, -0.7, 0]));
      for (const t of [-0.15, 0, 0.15]) shin.add(detail(mesh(`nail-${key}${side}-${t}`, ball(0.06, 0), '#e8e0cc', [t, -0.68, 0.32])));
      leg.add(shin);
      body.add(leg);
    }
  }

  const tail = part('tail', [0, 0.3, -1.38]);
  tail.add(mesh('tail', beam([0, 0, 0], [0, -0.9, -0.2], 0.07, 0.04, 5), p.skin));
  tail.add(detail(mesh('tail-tuft', ell(0.07, 0.14, 0.07), dark, [0, -0.95, -0.21])));
  body.add(tail);

  const wood = '#7a4f2a';
  if (p.howdah) {
    body.add(mesh('blanket', box(1.85, 0.06, 1.7), p.blanket, [0, 0.98, -0.1]));
    body.add(detail(mesh('blanket-fringe', box(1.9, 0.08, 1.75), shade(p.blanket, 1.5), [0, 0.92, -0.1])));
    body.add(mesh('howdah-basket', box(1.1, 0.55, 1.1), wood, [0, 1.3, -0.1]));
    body.add(detail(mesh('howdah-rim', box(1.18, 0.08, 1.18), shade(wood, 0.7), [0, 1.58, -0.1])));
    for (const [x, z] of [[0.5, 0.4], [-0.5, 0.4], [0.5, -0.6], [-0.5, -0.6]]) {
      body.add(detail(mesh(`howdah-post-${x}-${z}`, cyl(0.04, 0.04, 1.3, 5), shade(wood, 0.8), [x, 2.2, z])));
    }
    // Roof sits above the seated rider's head (hips at the socket + ~1.1 m).
    body.add(mesh('howdah-roof', cone(0.95, 0.5, 4), p.blanket, [0, 3.1, -0.1], [0, Math.PI / 4, 0]));
    body.add(socket('saddle', [0, 1.55, -0.1]));
  } else {
    body.add(mesh('blanket', box(1.2, 0.05, 1.0), p.blanket, [0, 1.0, -0.2]));
    body.add(socket('saddle', [0, 1.08, -0.2]));
  }
  return root;
}
