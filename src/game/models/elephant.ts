// Low-poly elephant / mammoth (quadruped rig), sculpted after a TABS-style mammoth
// reference: barrel torso with a shoulder hump sloping down to the rump, small domed
// skull with a dark fur cap, ring-pupil eye, segmented trunk, spiral tusk sweep.
// The elephant variant (fur = false) keeps a level back, big ears and short tusks.
import type * as THREE from 'three';
import type { ElephantParams } from '@/shared/schema';
import { ball, beam, box, cone, cyl, detail, ell, faceColors, jitter, mesh, modelRoot, part, shade, socket, sweep, type Vec3 } from './common';

const TUSK_STATIONS = 14;

/**
 * Tusk centreline: an arc in the sagittal (y, z) plane around (cy, cz), starting at the
 * jaw (angle -100°) and sweeping down → forward → up by `arc` radians while the radius
 * shrinks r0 → r1; `ky` stretches it vertically so the low sweep nears the ground.
 * Bowed outward along x by `bow`, tip pulled inward by `pinch`. `s` = side sign (+X = left).
 */
function tuskPath(s: number, arc: number, cy: number, cz: number, r0: number, r1: number, ky: number, bow: number, pinch: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < TUSK_STATIONS; i++) {
    const u = i / (TUSK_STATIONS - 1);
    const a = -1.745 + arc * u;
    const r = r0 + (r1 - r0) * u;
    pts.push([s * (0.3 + bow * Math.sin(Math.PI * u) - pinch * u), cy - r * ky * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return pts;
}

export function createElephantModel(p: ElephantParams, seed = 1): THREE.Group {
  const root = modelRoot(p.fur ? 'mammoth' : 'elephant', 'quadruped');
  const dark = shade(p.skin, 0.72);
  const skin = (geo: THREE.BufferGeometry, s: number) => (p.fur ? faceColors(jitter(geo, 0.08, seed + s), p.skin, shade(p.skin, 0.86), seed + s) : geo);

  // torso: barrel + shoulder hump; the barrel's own curvature drops the back to the rump
  const body = part('body', [0, 2.05, 0]);
  root.add(body);
  body.add(mesh('body', skin(ell(0.98, 0.88, 1.42), 1), p.skin, [0, -0.08, -0.05]));
  if (p.fur) {
    body.add(mesh('shoulder-hump', skin(ell(0.64, 0.8, 1.05), 2), p.skin, [0, 0.3, 0.36]));
  } else {
    body.add(mesh('withers', ell(0.84, 0.4, 0.98), p.skin, [0, 0.42, 0.32]));
  }

  const head = part('head', [0, 0.18, 1.3]);
  body.add(head);
  head.add(mesh('head', skin(ell(0.66, 0.74, 0.62), 3), p.skin, [0, 0.18, 0.22]));
  if (p.fur) {
    head.add(mesh('crown-fur', faceColors(jitter(ell(0.58, 0.32, 0.62), 0.1, seed + 4), dark, shade(p.skin, 0.6), seed + 4), dark, [0, 0.66, -0.05]));
  } else {
    head.add(mesh('crown', ell(0.52, 0.36, 0.48), p.skin, [0, 0.5, 0.05]));
  }
  for (const s of [1, -1] as const) {
    const side = s > 0 ? 'L' : 'R';
    head.add(detail(mesh(`eye-white-${side}`, ell(0.04, 0.15, 0.15), '#eef0ea', [0.52 * s, 0.3, 0.52], [0, 0.55 * s, 0])));
    head.add(detail(mesh(`eye-pupil-${side}`, ball(0.07, 0), '#1a1c1c', [0.56 * s, 0.3, 0.56])));
    const ear = part(`ear${side}`, [0.46 * s, 0.2, 0.0]);
    if (p.fur) {
      ear.add(mesh(`ear-${side}`, skin(ell(0.07, 0.28, 0.24), 5 + s), dark, [0.06 * s, -0.04, -0.12], [0, 0.35 * s, 0]));
    } else {
      ear.add(mesh(`ear-${side}`, ell(0.11, 0.62, 0.55), shade(p.skin, 0.9), [0.08 * s, -0.12, -0.26], [0, 0.35 * s, 0]));
    }
    head.add(ear);
  }

  // trunk: three chained pivots so it can curl; thick root, hangs between the tusks
  const trunk1 = part('trunk1', [0, -0.2, 0.72]);
  trunk1.add(mesh('trunk-1', skin(sweep([[0, 0.2, -0.15], [0, -0.25, 0.08], [0, -0.6, 0.16]], [0.34, 0.26, 0.21], 7), 6), p.skin));
  const trunk2 = part('trunk2', [0, -0.6, 0.16]);
  trunk2.add(mesh('trunk-2', sweep([[0, 0.05, 0], [0, -0.35, 0.02], [0, -0.62, 0.08]], [0.21, 0.17, 0.14], 7), p.skin));
  const trunk3 = part('trunk3', [0, -0.62, 0.08]);
  trunk3.add(mesh('trunk-3', sweep([[0, 0.05, 0], [0, -0.28, 0.08], [0, -0.4, 0.26], [0, -0.34, 0.38]], [0.14, 0.12, 0.1, 0.09], 7), shade(p.skin, 0.9)));
  trunk2.add(trunk3);
  trunk1.add(trunk2);
  head.add(trunk1);

  if (p.tusks) {
    // mammoth: ~270° spiral whose tip curls back up toward the eye; elephant: short hook
    const [arc, cy, cz, r0, r1, ky, bow, pinch, thick] = p.fur
      ? [4.3, -0.62, 1.5, 1.0, 0.62, 1.25, 0.26, 0.12, 0.15]
      : [2.9, -0.42, 1.15, 0.85, 0.62, 1, 0.14, 0, 0.13];
    const radii = Array.from({ length: TUSK_STATIONS }, (_, i) => thick * (1 - 0.88 * (i / (TUSK_STATIONS - 1)) ** 1.7));
    for (const s of [1, -1]) {
      head.add(mesh(`tusk-${s > 0 ? 'L' : 'R'}`, sweep(tuskPath(s, arc, cy, cz, r0, r1, ky, bow, pinch), radii, 8), p.tuskColor));
    }
  }

  // legs: tapered pillars with a wide foot pad; the thigh top buries into the barrel
  const legColor = p.fur ? shade(p.skin, 0.9) : p.skin;
  for (const [key, z] of [['F', 0.78], ['B', -0.9]] as const) {
    for (const s of [1, -1] as const) {
      const side = s > 0 ? 'L' : 'R';
      const leg = part(`leg${key}${side}`, [0.52 * s, -0.55, z]);
      leg.add(mesh(`shoulder-${key}${side}`, skin(ell(0.44, 0.52, 0.42), 30), legColor, [0, 0.4, 0]));
      leg.add(mesh(`thigh-${key}${side}`, skin(beam([0, 0.2, 0], [0, -0.8, 0], 0.4, 0.33, 8), 10), legColor));
      const shin = part(`shin${key}${side}`, [0, -0.75, 0]);
      shin.add(mesh(`shin-${key}${side}`, skin(beam([0, 0.1, 0], [0, -0.64, 0], 0.33, 0.34, 8), 20), legColor));
      shin.add(mesh(`foot-${key}${side}`, cyl(0.36, 0.39, 0.12, 9), shade(p.skin, 0.72), [0, -0.69, 0]));
      for (const t of [-0.17, 0, 0.17]) shin.add(detail(mesh(`nail-${key}${side}-${t}`, ball(0.07, 0), '#e8e4d4', [t, -0.68, 0.34])));
      leg.add(shin);
      body.add(leg);
    }
  }

  const tail = part('tail', [0, 0.2, -1.42]);
  if (p.fur) {
    tail.add(mesh('tail', beam([0, 0, 0], [0, -0.45, -0.15], 0.09, 0.06, 5), p.skin));
    tail.add(detail(mesh('tail-tuft', faceColors(jitter(ell(0.1, 0.18, 0.1), 0.04, seed + 7), dark, shade(p.skin, 0.6), seed + 7), dark, [0, -0.55, -0.17])));
  } else {
    tail.add(mesh('tail', beam([0, 0, 0], [0, -0.9, -0.2], 0.07, 0.04, 5), p.skin));
    tail.add(detail(mesh('tail-tuft', ell(0.07, 0.14, 0.07), dark, [0, -0.95, -0.21])));
  }
  body.add(tail);

  const wood = '#7a4f2a';
  if (p.howdah) {
    body.add(mesh('blanket', box(1.85, 0.06, 1.7), p.blanket, [0, 0.78, -0.1]));
    body.add(detail(mesh('blanket-fringe', box(1.9, 0.08, 1.75), shade(p.blanket, 1.5), [0, 0.72, -0.1])));
    body.add(mesh('howdah-basket', box(1.1, 0.55, 1.1), wood, [0, 1.1, -0.1]));
    body.add(detail(mesh('howdah-rim', box(1.18, 0.08, 1.18), shade(wood, 0.7), [0, 1.38, -0.1])));
    for (const [x, z] of [[0.5, 0.4], [-0.5, 0.4], [0.5, -0.6], [-0.5, -0.6]]) {
      body.add(detail(mesh(`howdah-post-${x}-${z}`, cyl(0.04, 0.04, 1.3, 5), shade(wood, 0.8), [x, 2.0, z])));
    }
    // Roof sits above the seated rider's head (hips at the socket + ~1.1 m).
    body.add(mesh('howdah-roof', cone(0.95, 0.5, 4), p.blanket, [0, 2.9, -0.1], [0, Math.PI / 4, 0]));
    body.add(socket('saddle', [0, 1.35, -0.1]));
  } else {
    // mammoth rider sits behind the hump, where the barrel top has dropped to ~0.75
    const [seatY, seatZ] = p.fur ? [0.74, -0.6] : [0.8, -0.2];
    body.add(mesh('blanket', ell(0.66, 0.1, 0.55), p.blanket, [0, seatY - 0.02, seatZ]));
    body.add(socket('saddle', [0, seatY + 0.08, seatZ]));
  }
  return root;
}
